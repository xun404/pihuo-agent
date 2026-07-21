import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { LocalStore } from './store.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('LocalStore session lamp watermarks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-lamp-'))
  const path = join(dir, 'state.json')
  const store = new LocalStore(path)

  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('markSessionRead stamps the watermark without bumping updatedAt', async () => {
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'proj') })
    const session = store.createSession({ projectId: project.id, title: 'S' })
    const createdUpdatedAt = session.updatedAt
    await sleep(5)
    const read = store.markSessionRead(session.id)
    assert.ok(read?.lastReadAt)
    assert.equal(read?.updatedAt, createdUpdatedAt)
    assert.ok(Date.parse(read!.lastReadAt!) >= Date.parse(createdUpdatedAt))
  })

  it('markSessionRead never moves the watermark backwards (upTo)', async () => {
    const project = store.upsertProject({ name: 'P2', rootPath: join(dir, 'proj2') })
    const session = store.createSession({ projectId: project.id, title: 'S2' })
    await sleep(5)
    const read = store.markSessionRead(session.id)
    const high = read!.lastReadAt!
    const older = new Date(Date.parse(high) - 60_000).toISOString()
    const again = store.markSessionRead(session.id, older)
    // No-op still returns the session (null means "not found")
    assert.equal(again?.lastReadAt, high)
  })

  it('markSessionRead returns null for unknown sessions', () => {
    assert.equal(store.markSessionRead('sess_nope'), null)
  })

  it('updateSessionStatus error stamps lastErrorAt; running clears sticky error and marks read', async () => {
    const project = store.upsertProject({ name: 'P3', rootPath: join(dir, 'proj3') })
    const session = store.createSession({ projectId: project.id, title: 'S3' })
    const errored = store.updateSessionStatus(session.id, 'error', { lastChatError: 'boom' })
    assert.equal(errored.lastChatError, 'boom')
    assert.ok(errored.lastErrorAt)
    assert.equal(errored.lastErrorAt, errored.lastChatErrorAt)
    await sleep(5)
    const running = store.updateSessionStatus(session.id, 'running', { lastChatError: null })
    assert.equal(running.lastChatError, undefined)
    assert.ok(Date.parse(running.lastReadAt!) > Date.parse(errored.lastErrorAt!))
  })

  it('updateJob stamps lastFinishedAt on success and lastErrorAt on failure (transition only)', async () => {
    const project = store.upsertProject({ name: 'P4', rootPath: join(dir, 'proj4') })
    const session = store.createSession({ projectId: project.id, title: 'S4' })
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      task: 't',
      cwd: project.rootPath,
      source: 'api',
      status: 'queued',
    })
    store.updateJob(job.id, { status: 'running', startedAt: new Date().toISOString() })
    await sleep(5)
    store.updateJob(job.id, { status: 'succeeded', finishedAt: new Date().toISOString() })
    const s1 = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.ok(s1.lastFinishedAt)
    assert.equal(s1.lastErrorAt, undefined)
    const stamped = s1.lastFinishedAt!
    // Re-applying the same terminal status is not a transition → no restamp
    await sleep(5)
    store.updateJob(job.id, { status: 'succeeded', output: 'more' })
    const s2 = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.equal(s2.lastFinishedAt, stamped)

    const job2 = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      task: 't2',
      cwd: project.rootPath,
      source: 'api',
      status: 'running',
    })
    store.updateJob(job2.id, { status: 'failed', finishedAt: new Date().toISOString() })
    const s3 = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.ok(s3.lastErrorAt)
  })

  it('a failed job no longer flips session status to error (lamp uses lastErrorAt)', () => {
    const project = store.upsertProject({ name: 'P5', rootPath: join(dir, 'proj5') })
    const session = store.createSession({ projectId: project.id, title: 'S5' })
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      task: 't',
      cwd: project.rootPath,
      source: 'api',
      status: 'running',
    })
    store.updateJob(job.id, { status: 'timed_out', finishedAt: new Date().toISOString() })
    const s = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.equal(s.status, 'idle')
    assert.ok(s.lastErrorAt)
  })

  it('recompute does not bump updatedAt on job events', async () => {
    const project = store.upsertProject({ name: 'P6', rootPath: join(dir, 'proj6') })
    const session = store.createSession({ projectId: project.id, title: 'S6' })
    const createdUpdatedAt = session.updatedAt
    await sleep(5)
    store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      task: 't',
      cwd: project.rootPath,
      source: 'api',
      status: 'queued',
    })
    const s = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.equal(s.status, 'running')
    assert.equal(s.updatedAt, createdUpdatedAt)
  })

  it('legacy sessions migrate lastReadAt to their updatedAt (no unread noise after upgrade)', () => {
    const project = store.upsertProject({ name: 'P7', rootPath: join(dir, 'proj7') })
    const updatedAt = new Date(Date.now() - 3_600_000).toISOString()
    const raw = {
      projects: [project],
      sessions: [
        {
          id: 'legacy1',
          projectId: project.id,
          title: 'Legacy',
          status: 'idle',
          mode: 'build',
          activeWorkerIds: [],
          memoryThreadId: 'mt',
          createdAt: updatedAt,
          updatedAt,
          lastReplyAt: updatedAt,
        },
      ],
      workers: [],
      approvals: [],
      jobs: [],
      activeProjectId: project.id,
      activeSessionId: 'legacy1',
    }
    writeFileSync(path, JSON.stringify(raw), 'utf8')
    const store2 = new LocalStore(path)
    const s = store2.snapshot().sessions.find((x) => x.id === 'legacy1')!
    assert.equal(s.lastReadAt, updatedAt)
  })

  it('markSessionReply clears the persisted running left by the chat send path', () => {
    const project = store.upsertProject({ name: 'P11', rootPath: join(dir, 'proj11') })
    const session = store.createSession({ projectId: project.id, title: 'S11' })
    store.updateSessionStatus(session.id, 'running')
    const done = store.markSessionReply(session.id)!
    assert.equal(done.status, 'idle')
    assert.ok(done.lastReplyAt)
  })

  it('reconcileSessionStatuses drops stale persisted running with no open jobs', async () => {
    const project = store.upsertProject({ name: 'P9', rootPath: join(dir, 'proj9') })
    const session = store.createSession({ projectId: project.id, title: 'S9' })
    // Simulate a crashed run: status persisted as running, no jobs behind it.
    store.updateSessionStatus(session.id, 'running')
    let s = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.equal(s.status, 'running')
    store.reconcileSessionStatuses()
    s = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.equal(s.status, 'idle')
  })

  it('reconcileSessionStatuses keeps running when an open job exists', () => {
    const project = store.upsertProject({ name: 'P10', rootPath: join(dir, 'proj10') })
    const session = store.createSession({ projectId: project.id, title: 'S10' })
    store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      task: 't',
      cwd: project.rootPath,
      source: 'api',
      status: 'running',
    })
    store.reconcileSessionStatuses()
    const s = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.equal(s.status, 'running')
  })

  it('clearAllSessionChatErrors also clears lastErrorAt so the red lamp goes out', () => {
    const project = store.upsertProject({ name: 'P8', rootPath: join(dir, 'proj8') })
    const session = store.createSession({ projectId: project.id, title: 'S8' })
    store.updateSessionStatus(session.id, 'error', { lastChatError: 'boom' })
    const cleared = store.clearAllSessionChatErrors()
    assert.ok(cleared >= 1)
    const s = store.snapshot().sessions.find((x) => x.id === session.id)!
    assert.equal(s.status, 'idle')
    assert.equal(s.lastErrorAt, undefined)
    assert.equal(s.lastChatError, undefined)
  })
})
