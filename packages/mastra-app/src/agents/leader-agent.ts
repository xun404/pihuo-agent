import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'
import { LibSQLStore } from '@mastra/libsql'
import {
  cancelJobTool,
  dispatchWorkerTool,
  getActiveContextTool,
  getJobTool,
  listJobsTool,
  listProjectsTool,
  listWorkersTool,
} from '../tools/session-tools.js'

function resolveLeaderModel(requestContext?: { get?: (key: string) => unknown }): string {
  // Per-request override from chat model picker (requestContext)
  try {
    const fromCtx = requestContext?.get?.('leaderModel')
    if (typeof fromCtx === 'string' && fromCtx.trim().includes('/')) {
      return fromCtx.trim()
    }
  } catch {
    /* ignore */
  }
  return process.env.LEADER_MODEL?.trim() || 'openai/gpt-5.5'
}

function resolveJudgeModel(): string {
  return process.env.GOAL_JUDGE_MODEL?.trim() || process.env.LEADER_MODEL?.trim() || 'openai/gpt-5-mini'
}

function memoryDbUrl(): string {
  return (
    process.env.MASTRA_MEMORY_URL ??
    `file:${process.env.HOME ?? process.cwd()}/.router-agents/mastra-memory.db`
  )
}

/**
 * Shared storage for Memory + Goals (thread state) + AgentController.
 * @see https://mastra.ai/docs/memory/overview
 * @see https://mastra.ai/docs/long-running-agents/goals
 */
export const leaderStorage = new LibSQLStore({
  id: 'router-agents-storage',
  url: memoryDbUrl(),
})

/**
 * Context management: lastMessages history + working memory.
 * Observational memory can be enabled via MASTRA_OM=1.
 * @see https://mastra.ai/docs/memory/overview
 */
export function createLeaderMemory(): Memory {
  const lastMessages = Number(process.env.MASTRA_LAST_MESSAGES ?? '40')
  const omEnabled = process.env.MASTRA_OM === '1' || process.env.MASTRA_OM === 'true'

  return new Memory({
    storage: leaderStorage,
    options: {
      lastMessages: Number.isFinite(lastMessages) && lastMessages > 0 ? lastMessages : 40,
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
  id: 'router-leader',
  name: 'Router Leader',
  description:
    'Orchestration leader that plans work and delegates to role-specialized CLI workers (plan, coder, review, test, research).',
  // Per-request model from chat picker via requestContext; else LEADER_MODEL settings
  model: ({ requestContext }) => resolveLeaderModel(requestContext),
  instructions: `You are the Router Agents Leader (Mastra Supervisor).

You run inside a macOS desktop command center. Users work in Projects and Sessions.
You coordinate specialized CLI coding agents (workers) rather than editing large codebases yourself.

## Worker roles (prefer routing by role)
- plan: break down work, architecture, step plans
- coder: implement features, refactors, multi-file edits
- review: code review, quality, risk, suggestions
- test: write/run tests, verify behavior
- research: explore codebase, gather facts, survey options
- general: flexible fallback when no specialist fits

Each worker has a primaryRole and a roles[] list. Prefer primaryRole matches, then any worker whose roles include the needed role.

Default product mapping (may change via UI):
- Claude Code → primary coder (also plan/research)
- Codex CLI → primary review (also coder/test)
- OpenCode → primary general (flexible)

Always call list-workers (optionally with role=) and get-active-context when you need current state.

## Modes (from UI)
- ask: answer questions, no destructive actions
- plan: produce a clear step plan; dispatch plan-role workers only if useful; do not implement unless asked
- build: short plan → dispatch role=coder → optionally role=test
- review: dispatch role=review; summarize findings

## Goals (durable objectives)
When a <current-objective> appears in context, keep working toward it until the judge marks it done.
Prefer concrete file paths and acceptance criteria in tool dispatches.

## Delegation / job scheduler
1. Pick role first via list-workers (prefer health=healthy and busy=false).
2. Call dispatch-worker with role + self-contained task (paths + acceptance criteria).
3. dispatch-worker returns jobId immediately (async). Tell the user the job id and worker name.
4. For results: call get-job(jobId) or list-jobs. status=succeeded + output means done.
5. Never claim files were changed unless a job succeeded with confirming output.
6. Permissions appear in the Approvals panel; user must allow for the job to continue.
7. cancel-job can stop queued/running work. Use list-jobs to inspect the session queue.
8. If no project is active, ask the user to open a project first.
9. Available roles: plan, coder, review, test, research, general.

## Response language
- Match the user's language (Chinese or English).
- Keep responses concise and structured for developers.
`,
  tools: {
    listProjectsTool,
    listWorkersTool,
    getActiveContextTool,
    dispatchWorkerTool,
    getJobTool,
    listJobsTool,
    cancelJobTool,
  },
  memory: leaderMemory,
  // Long worker dispatches run in the background so multi-session chat stays responsive
  // @see https://mastra.ai/docs/long-running-agents/background-tasks
  backgroundTasks: {
    tools: {
      dispatchWorkerTool: { enabled: true, timeoutMs: 600_000 },
    },
  },
  // Durable goals: judge model scores completion each loop iteration
  // @see https://mastra.ai/docs/long-running-agents/goals
  goal: {
    judge: () => resolveJudgeModel(),
    maxRuns: Number(process.env.GOAL_MAX_RUNS ?? '30') || 30,
    prompt:
      'Mark the goal complete only when the acceptance criteria are met with evidence (tests, file results, or clear completion). Prefer continue with a specific next step when unfinished.',
  },
})
