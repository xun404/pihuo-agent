import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { normalizeProjectRoot, dedupeProjectsByRoot } from './path-normalize.js'
import { LocalStore } from './store.js'

describe('normalizeProjectRoot', () => {
  it('strips trailing slashes and resolves absolute paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-path-'))
    try {
      const a = normalizeProjectRoot(dir + '/')
      const b = normalizeProjectRoot(dir + '//')
      const c = normalizeProjectRoot(dir)
      assert.equal(a, c)
      assert.equal(b, c)
      assert.ok(!a.endsWith('/') || a === '/')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('dedupeProjectsByRoot', () => {
  it('keeps one entry per normalized root', () => {
    const list = dedupeProjectsByRoot([
      { rootPath: '/tmp/foo', id: '1' },
      { rootPath: '/tmp/foo/', id: '2' },
      { rootPath: '/tmp/bar', id: '3' },
    ])
    assert.equal(list.length, 2)
    assert.equal(list[0]!.id, '1')
  })
})

describe('LocalStore project uniqueness + delete', () => {
  it('upsert same root different strings → one project; delete cleans sessions', () => {
    const statePath = join(mkdtempSync(join(tmpdir(), 'ra-store-')), 'state.json')
    const store = new LocalStore(statePath)
    const dir = mkdtempSync(join(tmpdir(), 'ra-proj-'))
    try {
      const p1 = store.upsertProject({ name: 'A', rootPath: dir })
      const p2 = store.upsertProject({ name: 'B', rootPath: dir + '/' })
      assert.equal(p1.id, p2.id)
      assert.equal(store.listProjects().length, 1)
      assert.equal(store.listProjects()[0]!.name, 'B')

      const s = store.createSession({ projectId: p1.id, title: 't1' })
      assert.equal(store.listSessions(p1.id).length, 1)
      store.deleteSession(s.id)
      assert.equal(store.listSessions(p1.id).length, 0)

      store.createSession({ projectId: p1.id, title: 't2' })
      store.deleteProject(p1.id)
      assert.equal(store.listProjects().length, 0)
      assert.equal(store.listSessions().length, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('LocalStore setActiveProject', () => {
  it('selects project and switches active session into that project', () => {
    const statePath = join(mkdtempSync(join(tmpdir(), 'ra-store-act-')), 'state.json')
    const store = new LocalStore(statePath)
    const d1 = mkdtempSync(join(tmpdir(), 'ra-p1-'))
    const d2 = mkdtempSync(join(tmpdir(), 'ra-p2-'))
    try {
      const a = store.upsertProject({ name: 'A', rootPath: d1 })
      const b = store.upsertProject({ name: 'B', rootPath: d2 })
      const sA = store.createSession({ projectId: a.id, title: 'on-a' })
      store.createSession({ projectId: b.id, title: 'on-b' })
      store.setActiveSession(sA.id)
      assert.equal(store.snapshot().activeProjectId, a.id)

      const selected = store.setActiveProject(b.id)
      assert.equal(selected.id, b.id)
      const snap = store.snapshot()
      assert.equal(snap.activeProjectId, b.id)
      const sess = snap.sessions.find((s) => s.id === snap.activeSessionId)
      assert.ok(sess)
      assert.equal(sess!.projectId, b.id)
    } finally {
      rmSync(d1, { recursive: true, force: true })
      rmSync(d2, { recursive: true, force: true })
    }
  })
})
