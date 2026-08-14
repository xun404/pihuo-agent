import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalStore, WorkerStoreConflictError } from './store.js'
import type { WorkerRegistration } from '@pihuo-agent/shared'

describe('LocalStore durability and ownership boundary', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'store-boundary-'))
    path = join(dir, 'state.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function worker(): WorkerRegistration {
    return {
      id: 'worker-boundary',
      name: 'Worker',
      kind: 'custom',
      command: 'worker',
      args: ['acp'],
      env: { WORKER_SETTING: 'before' },
      primaryRole: 'coder',
      roles: ['coder'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: 'test',
      defaultRoleType: 'coder',
      health: 'unknown',
      availableModels: [{ modelId: 'provider/model-a', name: 'Model A' }],
    }
  }

  it('does not retain nested references supplied by worker callers', () => {
    const store = new LocalStore(path)
    const input = worker()
    store.upsertWorker(input)
    input.args.push('mutated')
    input.env!.WORKER_SETTING = 'after'
    input.roles.push('review')
    input.capabilities.push('code-edit')
    input.availableModels![0]!.name = 'Mutated'

    const saved = store.listWorkers().find((candidate) => candidate.id === input.id)!
    assert.deepEqual(saved.args, ['acp'])
    assert.equal(saved.env?.WORKER_SETTING, 'before')
    assert.deepEqual(saved.roles, ['coder'])
    assert.deepEqual(saved.capabilities, ['general'])
    assert.equal(saved.availableModels?.[0]?.name, 'Model A')
  })

  it('atomically replaces the expected Worker despite unrelated Worker writes', () => {
    const store = new LocalStore(path)
    const expected = store.upsertWorker(worker())
    const unrelated = store.upsertWorker({ ...worker(), id: 'worker-unrelated' })
    store.upsertWorker({ ...unrelated, name: 'Unrelated changed' })

    const replacement = { ...expected, command: 'worker-v2', args: ['acp', '--v2'] }
    assert.deepEqual(store.compareAndSwapWorker(expected, replacement), replacement)
    assert.equal(
      store.listWorkers().find((candidate) => candidate.id === expected.id)?.command,
      'worker-v2',
    )
  })

  it('rejects a stale Worker snapshot without overwriting an intervening change', () => {
    const store = new LocalStore(path)
    const expected = store.upsertWorker(worker())
    const intervening = store.upsertWorker({ ...expected, authRevision: 4 })

    assert.throws(
      () => store.compareAndSwapWorker(expected, { ...expected, command: 'stale-v2' }),
      (error: unknown) => error instanceof WorkerStoreConflictError,
    )
    assert.deepEqual(
      store.listWorkers().find((candidate) => candidate.id === expected.id),
      intervening,
    )
  })

  it('rejects a stale Worker snapshot after deletion and never recreates it', () => {
    const store = new LocalStore(path)
    const expected = store.upsertWorker(worker())
    store.removeWorker(expected.id)

    assert.throws(
      () => store.compareAndSwapWorker(expected, { ...expected, command: 'resurrected' }),
      (error: unknown) => error instanceof WorkerStoreConflictError,
    )
    assert.equal(
      store.listWorkers().some((candidate) => candidate.id === expected.id),
      false,
    )
  })

  it('atomically removes only the exact expected Worker value', () => {
    const store = new LocalStore(path)
    const expected = store.upsertWorker(worker())

    assert.deepEqual(store.compareAndRemoveWorker(expected), expected)
    assert.equal(
      store.listWorkers().some((candidate) => candidate.id === expected.id),
      false,
    )

    const recreated = store.upsertWorker({ ...expected, authRevision: 2 })
    assert.throws(
      () => store.compareAndRemoveWorker(expected),
      (error: unknown) => error instanceof WorkerStoreConflictError,
    )
    assert.deepEqual(
      store.listWorkers().find((candidate) => candidate.id === expected.id),
      recreated,
    )
  })

  it('does not retain nested references supplied to createJob or updateJob', () => {
    const store = new LocalStore(path)
    const project = store.upsertProject({ name: 'P', rootPath: dir })
    const session = store.createSession({ projectId: project.id, title: 'S' })
    const meta = { source: { nested: 'before' } }
    const approvalIds = ['approval-1']
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w',
      workerName: 'W',
      task: 'work',
      cwd: dir,
      source: 'api',
      meta,
      approvalIds,
    })
    meta.source.nested = 'after'
    approvalIds.push('approval-2')
    assert.deepEqual(store.getJob(job.id)?.meta, { source: { nested: 'before' } })
    assert.deepEqual(store.getJob(job.id)?.approvalIds, ['approval-1'])

    const patchMeta = { source: { nested: 'updated-before' } }
    store.updateJob(job.id, { meta: patchMeta })
    patchMeta.source.nested = 'updated-after'
    assert.deepEqual(store.getJob(job.id)?.meta, { source: { nested: 'updated-before' } })
  })

  it('keeps memory revision unchanged and removes temp files when persistence fails', () => {
    const store = new LocalStore(path)
    const before = store.snapshot()
    unlinkSync(path)
    mkdirSync(path)

    assert.throws(() => store.setLocale(before.locale === 'zh' ? 'en' : 'zh'))
    assert.deepEqual(store.snapshot(), before)
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith('state.json.tmp.')),
      false,
    )
  })

  it('fails construction when the initial owner snapshot cannot be persisted', () => {
    const blocker = join(dir, 'not-a-directory')
    writeFileSync(blocker, 'x')
    const impossible = join(blocker, 'state.json')
    assert.equal(existsSync(impossible), false)
    assert.throws(() => new LocalStore(impossible))
  })
})
