import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'
import { loadSettings, resolveRouterDataPaths } from '@pihuo-agent/core'
import {
  normalizeLeaderWorkMode,
  normalizePromptSettings,
  type LeaderThinkingIntensity,
  type LeaderWorkMode,
} from '@pihuo-agent/shared'
import { buildLeaderInstructions } from '../agents/leader-instructions.js'
import { resolveLeaderPiModel, mapThinkingLevel } from './leader-model.js'
import { wrapPihuoTools, PIHUO_TOOL_NAMES } from './pihuo-tools.js'
import { createTaskTools, TASK_TOOL_NAMES } from './task-tools.js'
import type { LeaderRunContext } from './tool-context.js'

export type CreateLeaderSessionInput = {
  threadId: string
  workMode?: LeaderWorkMode
  modelId: string
  thinking?: LeaderThinkingIntensity
  projectRoot?: string
  run: LeaderRunContext
  instructionOptions: Parameters<typeof buildLeaderInstructions>[0]
}

export type LeaderSessionHandle = {
  session: AgentSession
  workMode: LeaderWorkMode
  modelId: string
  jsonlPath: string
}

const BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const

export function leaderSessionPath(threadId: string): string {
  const paths = resolveRouterDataPaths()
  mkdirSync(paths.sessionsDir, { recursive: true })
  return join(paths.sessionsDir, `${threadId}.jsonl`)
}

export async function createLeaderSession(
  input: CreateLeaderSessionInput,
): Promise<LeaderSessionHandle> {
  const workMode = normalizeLeaderWorkMode(input.workMode)
  if (workMode === 'coding' && !input.projectRoot?.trim()) {
    throw new Error('coding workMode requires a bound project root')
  }
  const paths = resolveRouterDataPaths()
  mkdirSync(paths.piAgentDir, { recursive: true })
  const jsonlPath = leaderSessionPath(input.threadId)
  const cwd = input.projectRoot?.trim() || paths.piAgentDir
  const { runtime, model, modelId } = await resolveLeaderPiModel(input.modelId)
  const customTools = [...wrapPihuoTools(input.run), ...createTaskTools(input.threadId)]
  const customNames = [...PIHUO_TOOL_NAMES, ...TASK_TOOL_NAMES]
  const settings = loadSettings()
  const prompts = normalizePromptSettings(settings.prompts)
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
  })
  const instructions = buildLeaderInstructions({
    ...input.instructionOptions,
    leaderPrompt: input.instructionOptions?.leaderPrompt ?? prompts.leader,
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: paths.piAgentDir,
    settingsManager,
    noExtensions: workMode === 'coordinate',
    noSkills: workMode === 'coordinate',
    noPromptTemplates: workMode === 'coordinate',
    noContextFiles: workMode === 'coordinate',
    systemPrompt: instructions,
    systemPromptOverride: () => instructions,
    appendSystemPromptOverride: () => [],
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd,
    agentDir: paths.piAgentDir,
    model,
    thinkingLevel: mapThinkingLevel(input.thinking),
    modelRuntime: runtime,
    customTools,
    tools: workMode === 'coding' ? [...BUILTIN_TOOLS, ...customNames] : [...customNames],
    noTools: workMode === 'coordinate' ? 'builtin' : undefined,
    sessionManager: SessionManager.open(jsonlPath, paths.sessionsDir, cwd),
    settingsManager,
    resourceLoader,
  })
  return { session, workMode, modelId, jsonlPath }
}
