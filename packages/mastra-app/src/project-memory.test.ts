import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Project, Session } from '@swarmdesk-agent/shared'

let service: typeof import('./project-memory.js')
let dir: string
const previousMemoryUrl = process.env.MASTRA_MEMORY_URL

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ra-project-memory-service-'))
  process.env.MASTRA_MEMORY_URL = `file:${join(dir, 'memory.db')}`
  service = await import('./project-memory.js')
})

after(() => {
  if (previousMemoryUrl === undefined) delete process.env.MASTRA_MEMORY_URL
  else process.env.MASTRA_MEMORY_URL = previousMemoryUrl
  rmSync(dir, { recursive: true, force: true })
})

function contextFixture() {
  const project = {
    id: 'project-memory-test',
    name: 'Memory test project',
    rootPath: '/tmp/memory-test-project',
    memoryEnabled: true,
    workerIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Project
  const session = {
    id: 'session-memory-test',
    projectId: project.id,
    memoryThreadId: 'thread-memory-test',
  } as Session
  const otherSession = {
    id: 'session-other-project',
    projectId: 'project-other',
    memoryThreadId: 'thread-other',
  } as Session
  const store = {
    listProjects: () => [project],
    listSessions: (projectId?: string) =>
      projectId === project.id ? [session] : projectId === 'project-other' ? [otherSession] : [],
  }
  return { project, session, store }
}

describe('project memory service', () => {
  it('keeps the resource scope and disables only working memory', () => {
    assert.equal(service.isProjectMemoryEnabled(undefined), true)
    assert.equal(service.isProjectMemoryEnabled({ memoryEnabled: false }), false)
    const enabled = service.resolveProjectMemoryOptions(true)
    const disabled = service.resolveProjectMemoryOptions(false)
    assert.deepEqual(enabled.workingMemory, { enabled: true, scope: 'resource' })
    assert.deepEqual(disabled.workingMemory, { enabled: false, scope: 'resource' })
    assert.equal(disabled.semanticRecall, false)
  })

  it('binds a thread to the requested project and rejects a cross-project thread', () => {
    const { project, session, store } = contextFixture()
    const byThread = service.resolveProjectMemoryContext(store, project.id, session.memoryThreadId)
    assert.equal(byThread?.threadId, session.memoryThreadId)
    assert.equal(byThread?.session.id, session.id)
    assert.equal(service.resolveProjectMemoryContext(store, project.id, 'thread-other'), null)
    assert.equal(service.resolveProjectMemoryContext(store, project.id, '   '), null)
  })

  it('round-trips empty and non-empty working memory content', async () => {
    const { project, store } = contextFixture()
    const context = service.resolveProjectMemoryContext(store, project.id, 'thread-memory-test')
    assert.ok(context)

    const empty = await service.updateProjectWorkingMemory(context, '')
    assert.equal(empty.content, '')
    const saved = await service.updateProjectWorkingMemory(context, 'Keep the API contract stable.')
    assert.equal(saved.content, 'Keep the API contract stable.')
    assert.equal((await service.readProjectMemory(context)).content, saved.content)
  })
})
