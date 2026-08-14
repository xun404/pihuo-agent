import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, Session } from '@pihuo-agent/shared'
import { resolveRouterDataPaths } from '@pihuo-agent/core'
import { resolveMemoryLastMessages } from './runtime-config.js'

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

export function isProjectMemoryEnabled(project: Pick<Project, 'memoryEnabled'> | null | undefined) {
  return project?.memoryEnabled !== false
}

export function resolveProjectMemoryOptions(enabled: boolean) {
  return {
    lastMessages: resolveMemoryLastMessages(),
    workingMemory: {
      enabled,
      scope: 'resource' as const,
    },
    semanticRecall: false,
    observationalMemory: false,
  }
}

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

function memoryFile(projectId: string): string {
  const dir = resolveRouterDataPaths().projectMemoryDir
  mkdirSync(dir, { recursive: true })
  return join(dir, `${projectId}.md`)
}

function readMemoryFile(projectId: string): string {
  try {
    return readFileSync(memoryFile(projectId), 'utf8')
  } catch {
    return ''
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
  const content = readMemoryFile(context.project.id)
  return {
    projectId: context.project.id,
    enabled,
    content,
    lastMessages: resolveMemoryLastMessages(),
    workingMemory: enabled,
    semanticRecall: false,
    observationalMemory: false,
    storage: resolveRouterDataPaths().projectMemoryDir,
    docs: '',
  }
}

export async function updateProjectWorkingMemory(
  context: ProjectMemoryContext,
  content: string,
): Promise<ProjectMemorySnapshot> {
  assertMemoryContent(content)
  writeFileSync(memoryFile(context.project.id), content, 'utf8')
  return readProjectMemory(context)
}

export function projectMemoryPrompt(projectId: string, enabled: boolean): string {
  if (!enabled) return ''
  const content = readMemoryFile(projectId).trim()
  if (!content) return ''
  return `\n## Project memory\n${content}\n`
}
