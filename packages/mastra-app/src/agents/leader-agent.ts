import { Agent } from '@mastra/core/agent'
import { TaskSignalProvider } from '@mastra/core/signals'
import { Memory } from '@mastra/memory'
import { LibSQLStore } from '@mastra/libsql'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_LEADER_MODEL, loadSettings, resolveRouterDataPaths } from '@swarmdesk-agent/core'
import { normalizePromptSettings } from '@swarmdesk-agent/shared'
import { resolveGoalMaxRuns, resolveMemoryLastMessages } from '../runtime-config.js'
import {
  cancelJobTool,
  archiveRoleDefinitionTool,
  createRoleDefinitionTool,
  dispatchRoleTool,
  getActiveContextTool,
  getJobTool,
  listJobsTool,
  listWorkersTool,
  listProjectsTool,
  listRoleDefinitionsTool,
  resetRoleSessionTool,
  updateRoleDefinitionTool,
} from '../tools/session-tools.js'
import { buildLeaderInstructions } from './leader-instructions.js'

function resolveLeaderModelId(requestContext?: { get?: (key: string) => unknown }): string {
  // Per-request override from chat model picker (requestContext)
  try {
    const fromCtx = requestContext?.get?.('leaderModel')
    if (typeof fromCtx === 'string' && fromCtx.trim().includes('/')) {
      return fromCtx.trim()
    }
  } catch {
    /* ignore */
  }
  return process.env.LEADER_MODEL?.trim() || DEFAULT_LEADER_MODEL
}

/**
 * Request-scoped model config. Custom gateway baseURL/apiKey are returned on the
 * model object — never by mutating global OPENAI_BASE_URL / ANTHROPIC_BASE_URL.
 */
export function resolveLeaderModelConfig(requestContext?: {
  get?: (key: string) => unknown
}): string | { id: `${string}/${string}`; url?: string; apiKey?: string } {
  const modelId = resolveLeaderModelId(requestContext)
  if (!modelId.includes('/')) return modelId

  let custom: Array<{
    id: string
    baseURL?: string
    apiKeyEnv?: string
    apiStyle?: string
  }> = []
  try {
    custom = loadSettings().customProviders ?? []
  } catch {
    custom = []
  }

  const providerId = modelId.slice(0, modelId.indexOf('/'))
  const match = custom.find((c) => c.id === providerId || c.id.replace(/_/g, '-') === providerId)
  if (!match?.baseURL?.trim()) {
    // Builtin / no custom base — plain model id (Mastra uses process env keys)
    return modelId
  }

  const apiKeyEnv = match.apiKeyEnv?.trim()
  // Authoritative: the env name configured on the custom provider (saved secret).
  // applySecretsToEnv forces aliases equal so shell ambient cannot diverge.
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv]?.trim() : undefined
  return {
    id: modelId as `${string}/${string}`,
    url: match.baseURL.trim().replace(/\/$/, ''),
    ...(apiKey ? { apiKey } : {}),
  }
}

function resolveJudgeModel(): string {
  return (
    process.env.GOAL_JUDGE_MODEL?.trim() || process.env.LEADER_MODEL?.trim() || 'openai/gpt-5-mini'
  )
}

function memoryDbUrl(): string {
  if (process.env.MASTRA_MEMORY_URL?.trim()) return process.env.MASTRA_MEMORY_URL.trim()
  const dbPath = resolveRouterDataPaths().memoryDbPath
  // The data layer dir may not exist yet on first run; LibSQLStore opens the
  // db at construction time (module top-level), so ensure the parent exists.
  try {
    mkdirSync(dirname(dbPath), { recursive: true })
  } catch {
    /* best effort — libsql will surface a clearer error if unwritable */
  }
  return `file:${dbPath}`
}

/**
 * Shared storage for Memory + Goals (thread state) + AgentController.
 * @see https://mastra.ai/docs/memory/overview
 * @see https://mastra.ai/docs/long-running-agents/goals
 */
export const leaderStorage = new LibSQLStore({
  id: 'swarmdesk-agent-storage',
  url: memoryDbUrl(),
})

/**
 * Context management: lastMessages history + working memory.
 * Observational memory can be enabled via MASTRA_OM=1.
 * @see https://mastra.ai/docs/memory/overview
 */
export function createLeaderMemory(): Memory {
  const lastMessages = resolveMemoryLastMessages()
  const omEnabled = process.env.MASTRA_OM === '1' || process.env.MASTRA_OM === 'true'

  return new Memory({
    storage: leaderStorage,
    options: {
      lastMessages,
      workingMemory: {
        enabled: true,
        scope: 'resource',
      },
      // Semantic recall needs a vector store; keep off unless configured
      semanticRecall: false,
      ...(omEnabled
        ? {
            observationalMemory: {
              model: process.env.MASTRA_OM_MODEL?.trim() || 'google/gemini-2.5-flash',
            },
          }
        : {}),
    },
  })
}

export const leaderMemory = createLeaderMemory()

export const leaderAgent = new Agent({
  id: 'swarmdesk-leader',
  name: 'SwarmDesk Leader',
  description:
    'Orchestration leader that plans work and delegates to role-specialized CLI workers (plan, coder, review, test, research).',
  // Per-request model + optional gateway url/apiKey (never mutates process.env base URL)
  model: ({ requestContext }) => resolveLeaderModelConfig(requestContext),
  // Rebuild each turn so the Leader sees the latest Workers panel model pins / catalogs
  instructions: ({ requestContext }) => {
    const prompts = normalizePromptSettings(loadSettings().prompts)
    return buildLeaderInstructions({
      roleReviewPending: requestContext?.get('roleReviewPending') === true,
      bootstrappedRoleCount: Number(requestContext?.get('bootstrappedRoleCount') ?? 0),
      leaderPrompt: prompts.leader,
    })
  },
  tools: {
    listProjectsTool,
    getActiveContextTool,
    listWorkersTool,
    listRoleDefinitionsTool,
    createRoleDefinitionTool,
    updateRoleDefinitionTool,
    archiveRoleDefinitionTool,
    resetRoleSessionTool,
    dispatchRoleTool,
    getJobTool,
    listJobsTool,
    cancelJobTool,
  },
  memory: leaderMemory,
  // TaskSignalProvider bundles task_write/update/complete/check + the
  // TaskStateProcessor that persists the task list to the thread-scoped
  // `tasks` (threadState) domain so it survives across turns. Without it the
  // built-in task tools keep the list only in transient tool-call state and
  // silently lose it next turn. Backed by the same LibSQL leaderStorage.
  signals: [new TaskSignalProvider()],
  // NOTE: do NOT put role dispatch in backgroundTasks.
  // Background wrapping returns before wait=true finishes, so the Leader
  // polls get-job with a missing jobId and the chat stream ends early.
  // Long ACP runs stay open via chat untilIdle while the tool blocks on wait.
  // @see https://mastra.ai/docs/long-running-agents/background-tasks
  // Durable goals: judge model scores completion each loop iteration
  // @see https://mastra.ai/docs/long-running-agents/goals
  goal: {
    judge: () => resolveJudgeModel(),
    maxRuns: resolveGoalMaxRuns(),
    prompt:
      'Mark the goal complete only when the acceptance criteria are met with evidence (tests, file results, or clear completion). Prefer continue with a specific next step when unfinished.',
  },
})
