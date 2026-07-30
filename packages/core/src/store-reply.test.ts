import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalStore } from './store.js'

const dirs: string[] = []

function freshStore(): { store: LocalStore; projectId: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ra-reply-'))
  dirs.push(dir)
  const store = new LocalStore(join(dir, 'state.json'))
  const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'proj') })
  return { store, projectId: project.id }
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

describe('Session — lastReplyAt', () => {
  describe('createSession', () => {
    it('omits lastReplyAt until a reply lands (sidebar falls back to createdAt)', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      assert.equal(s.lastReplyAt, undefined)
    })
  })

  describe('markSessionReply', () => {
    it('sets lastReplyAt and bumps updatedAt', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      // createdAt strictly before the mark so we can assert ordering even under
      // a coarse ms clock.
      const before = new Date(s.createdAt).getTime()
      const marked = store.markSessionReply(s.id)
      assert.ok(marked)
      const lastReplyAt = marked.lastReplyAt
      assert.equal(typeof lastReplyAt, 'string')
      assert.ok(lastReplyAt)
      assert.ok(new Date(lastReplyAt).getTime() >= before)
      assert.equal(marked.updatedAt, lastReplyAt)
    })

    it('preserves title / build mode / memoryThreadId / permission state', () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId, mode: 'review', title: 'T' })
      const marked = store.markSessionReply(s.id)
      assert.ok(marked)
      assert.equal(marked!.title, 'T')
      assert.equal(marked!.mode, 'build')
      assert.equal(marked!.memoryThreadId, s.memoryThreadId)
      assert.equal(marked!.approvalPolicy, s.approvalPolicy)
      assert.equal(marked!.permissionMode, s.permissionMode)
    })

    it('advances lastReplyAt on each call', async () => {
      const { store, projectId } = freshStore()
      const s = store.createSession({ projectId })
      const first = store.markSessionReply(s.id)
      assert.ok(first?.lastReplyAt)
      // Sleep past the ms-clock granularity so the second stamp is strictly later.
      await new Promise((r) => setTimeout(r, 5))
      const second = store.markSessionReply(s.id)
      assert.ok(second?.lastReplyAt)
      assert.ok(new Date(second.lastReplyAt).getTime() > new Date(first.lastReplyAt).getTime())
    })

    it('returns null for unknown session (no throw)', () => {
      const { store } = freshStore()
      assert.equal(store.markSessionReply('sess-missing'), null)
    })

    it('persisted snapshot keeps lastReplyAt across reload', () => {
      const ctx = freshStore()
      const s = ctx.store.createSession({ projectId: ctx.projectId })
      ctx.store.markSessionReply(s.id)
      const snap = ctx.store.snapshot()
      const found = snap.sessions.find((x) => x.id === s.id)
      assert.ok(found?.lastReplyAt)
    })
  })
})
