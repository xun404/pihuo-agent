import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalStore } from './store.js'
import { DEFAULT_SESSION_TITLE, isPlaceholderSessionTitle } from '@swarmdesk-agent/shared'

const dirs: string[] = []

function freshStore(): { store: LocalStore; dir: string; path: string; projectId: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ra-rename-'))
  dirs.push(dir)
  const path = join(dir, 'state.json')
  const store = new LocalStore(path)
  const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'proj') })
  return { store, dir, path, projectId: project.id }
}

after(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('Session title — delayed naming', () => {
  describe('createSession title optionality', () => {
    it('omits title → placeholder + titleSource=auto', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      assert.equal(s.title, DEFAULT_SESSION_TITLE)
      assert.equal(s.titleSource, 'auto')
      assert.equal(isPlaceholderSessionTitle(s.title), true)
    })

    it('blank title → placeholder + titleSource=auto', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId, title: '   ' })
      assert.equal(s.title, DEFAULT_SESSION_TITLE)
      assert.equal(s.titleSource, 'auto')
    })

    it('provided title → kept + titleSource=user (locked)', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId, title: 'My Task' })
      assert.equal(s.title, 'My Task')
      assert.equal(s.titleSource, 'user')
    })
  })

  describe('renameSession', () => {
    it('sets title + titleSource=user + bumps updatedAt', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      const renamed = store.renameSession(s.id, '  Renamed  ')
      assert.equal(renamed.title, 'Renamed') // trimmed
      assert.equal(renamed.titleSource, 'user')
      assert.ok(renamed.updatedAt >= s.updatedAt)
    })

    it('preserves mode, activeWorkerIds, memoryThreadId, approvalPolicy', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId, mode: 'review' })
      const renamed = store.renameSession(s.id, 'Other')
      assert.equal(renamed.mode, 'review')
      assert.equal(renamed.approvalPolicy, s.approvalPolicy)
      assert.equal(renamed.memoryThreadId, s.memoryThreadId)
      assert.deepEqual(renamed.activeWorkerIds, s.activeWorkerIds)
    })

    it('rejects empty / whitespace-only title', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      assert.throws(() => store.renameSession(s.id, '   '), /title required/i)
    })

    it('rejects unknown session', () => {
      const { store } = freshStore()
      assert.throws(() => store.renameSession('sess-missing', 'X'), /not found/i)
    })

    it('persisted snapshot is consistent after rename', () => {
      const ctx = freshStore()
      const s = ctx.store.createSession({ projectId: ctx.projectId })
      ctx.store.renameSession(s.id, 'Persisted')
      const raw = JSON.parse(readFileSync(ctx.path, 'utf8')) as {
        sessions: Array<{ id: string; title: string; titleSource?: string }>
      }
      const found = raw.sessions.find((x) => x.id === s.id)
      assert.equal(found?.title, 'Persisted')
      assert.equal(found?.titleSource, 'user')
    })
  })

  describe('autoTitleSession (Leader first-task hook)', () => {
    it('overwrites an auto-titled (placeholder) session', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      const out = store.autoTitleSession(s.id, 'Implement sidebar')
      assert.ok(out)
      assert.equal(out!.title, 'Implement sidebar')
      assert.equal(out!.titleSource, 'auto')
    })

    it('does NOT overwrite a user-renamed session (lock)', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      store.renameSession(s.id, 'User Choice')
      const out = store.autoTitleSession(s.id, 'Auto Attempt')
      // Lock holds: title unchanged, return value null (no write)
      assert.equal(out, null)
      const after = store.snapshot().sessions.find((x) => x.id === s.id)
      assert.equal(after?.title, 'User Choice')
      assert.equal(after?.titleSource, 'user')
    })

    it('returns null for empty title', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      assert.equal(store.autoTitleSession(s.id, '   '), null)
    })

    it('returns null for unknown session (no throw)', () => {
      const { store } = freshStore()
      assert.equal(store.autoTitleSession('sess-missing', 'X'), null)
    })

    it('legacy snapshot with a real title is not overwritten by auto-naming', () => {
      const ctx = freshStore()
      const project = ctx.store.snapshot().projects[0]!
      const legacyRaw = {
        projects: [project],
        sessions: [
          {
            id: 's-legacy',
            projectId: project.id,
            title: 'Legacy Real Title',
            status: 'idle',
            mode: 'build',
            activeWorkerIds: [],
            memoryThreadId: 'mt-leg',
            approvalPolicy: 'manual',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        workers: [],
        approvals: [],
        jobs: [],
        activeProjectId: project.id,
        activeSessionId: 's-legacy',
      }
      writeFileSync(ctx.path, JSON.stringify(legacyRaw), 'utf8')
      const store2 = new LocalStore(ctx.path)
      const out = store2.autoTitleSession('s-legacy', 'Fresh Title')
      assert.equal(out, null)
      const after = store2.snapshot().sessions.find((session) => session.id === 's-legacy')
      assert.equal(after?.title, 'Legacy Real Title')
      assert.equal(after?.titleSource, undefined)
    })
  })
})
