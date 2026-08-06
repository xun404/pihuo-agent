import type { MemoryConfigInternal } from '@mastra/core/memory'
import type { Project, Session } from '@swarmdesk-agent/shared'
import { resolveRouterDataPaths } from '@swarmdesk-agent/core'
import { leaderMemory } from './agents/leader-agent.js'
import { resolveMemoryLastMessages } from './runtime-config.js'

const MEMORY_DOCS_URL = 'https://mastra.ai/docs/memory/overview'
const MAX_PROJECT_MEMORY_CONTENT_LENGTH = 200_000

export interface ProjectMemorySnapshot {
  projectId: string
  enabled: boolean
  content: string
  lastMessages: number
  workingMemory: boolean
  semanticRecall: boolean
  observationalMemory: boolean
  storage: string
  docs: string
}

export interface ProjectMemoryContext {
  project: Project
  session: Session
  threadId: string
}

export interface ProjectMemoryStoreView {
  listProjects(): Project[]
  listSessions(projectId?: string): Session[]
}

/** Existing projects predate this field and had working memory enabled. */
export function isProjectMemoryEnabled(project: Pick<Project, 'memoryEnabled'> | null | undefined) {
  return project?.memoryEnabled !== false
}

/**
 * Resolve the only memory options that can be controlled by a Project.
 *
 * The Memory instance remains shared so LibSQL concurrency behavior stays the
 * same; these options are passed per request and cannot be forged by the UI.
 */
export function resolveProjectMemoryOptions(enabled: boolean): MemoryConfigInternal {
  const observationalMemory = process.env.MASTRA_OM === '1' || process.env.MASTRA_OM === 'true'
  return {
    lastMessages: resolveMemoryLastMessages(),
    workingMemory: {
      enabled,
      scope: 'resource',
    },
    semanticRecall: false,
    ...(observationalMemory
      ? {
          observationalMemory: {
            model: process.env.MASTRA_OM_MODEL?.trim() || 'google/gemini-2.5-flash',
          },
        }
      : {}),
  }
}

/**
 * Bind a memory request to a persisted Router Session before using its
 * Project resource. A raw project id + arbitrary thread id is never enough.
 */
export function resolveProjectMemoryContext(
  store: ProjectMemoryStoreView,
  projectId: string,
  requestedThreadId: string,
): ProjectMemoryContext | null {
  const project = store.listProjects().find((candidate) => candidate.id === projectId)
  if (!project) return null

  const threadId = requestedThreadId.trim()
  if (!threadId) return null
  const session = store
    .listSessions(projectId)
    .find((candidate) => candidate.memoryThreadId === threadId || candidate.id === threadId)
  if (!session) return null

  return {
    project,
    session,
    threadId: session.memoryThreadId,
  }
}

function assertMemoryContent(content: string): void {
  if (content.length > MAX_PROJECT_MEMORY_CONTENT_LENGTH) {
    throw new Error('PROJECT_MEMORY_CONTENT_TOO_LARGE')
  }
}

export async function readProjectMemory(
  context: ProjectMemoryContext,
): Promise<ProjectMemorySnapshot> {
  const enabled = isProjectMemoryEnabled(context.project)
  const content =
    (await leaderMemory.getWorkingMemory({
      threadId: context.threadId,
      resourceId: context.project.id,
      // Read existing content even while disabled so the UI can show it and
      // re-enabling never silently discards the project memory.
      memoryConfig: resolveProjectMemoryOptions(true),
    })) ?? ''

  return {
    projectId: context.project.id,
    enabled,
    content,
    lastMessages: resolveMemoryLastMessages(),
    workingMemory: enabled,
    semanticRecall: false,
    observationalMemory: process.env.MASTRA_OM === '1' || process.env.MASTRA_OM === 'true',
    storage: resolveRouterDataPaths().memoryDbPath,
    docs: MEMORY_DOCS_URL,
  }
}

export async function updateProjectWorkingMemory(
  context: ProjectMemoryContext,
  content: string,
): Promise<ProjectMemorySnapshot> {
  assertMemoryContent(content)
  await leaderMemory.updateWorkingMemory({
    threadId: context.threadId,
    resourceId: context.project.id,
    workingMemory: content,
    memoryConfig: resolveProjectMemoryOptions(true),
  })
  return readProjectMemory(context)
}
