import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getSharedStore, resetSharedStoreForTests } from '@pihuo-agent/core'
import { setSessionTitleTool } from './session-tools.js'

describe('setSessionTitleTool', () => {
  let dir: string
  let previousStatePath: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'session-title-tool-'))
    previousStatePath = process.env.PIHUO_AGENT_AGENTS_STATE
    process.env.PIHUO_AGENT_AGENTS_STATE = join(dir, 'state.json')
    resetSharedStoreForTests()
  })

  afterEach(() => {
    resetSharedStoreForTests()
    if (previousStatePath === undefined) delete process.env.PIHUO_AGENT_AGENTS_STATE
    else process.env.PIHUO_AGENT_AGENTS_STATE = previousStatePath
    rmSync(dir, { recursive: true, force: true })
  })

  it('normalizes a model title prefix before persisting the first automatic title', async () => {
    const store = getSharedStore({ mode: 'owner' })
    const project = store.upsertProject({ name: 'P', rootPath: dir })
    const session = store.createSession({ projectId: project.id })
    const context = {
      requestContext: {
        get(key: string) {
          return {
            routerSessionId: session.id,
            routerProjectId: project.id,
            memoryThreadId: session.memoryThreadId,
          }[key]
        },
      },
    }

    const result = await setSessionTitleTool.execute!(
      { title: 'Title: Review ACP reasoning' },
      context as never,
    )

    assert.deepEqual(result, { ok: true, title: 'Review ACP reasoning' })
    assert.equal(
      store.listSessions().find((candidate) => candidate.id === session.id)?.title,
      'Review ACP reasoning',
    )
  })
})
