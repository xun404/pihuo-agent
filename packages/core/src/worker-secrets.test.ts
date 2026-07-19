import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTestMasterKey } from './secure-secrets.js'
import {
  setWorkerSecret,
  listWorkerSecretKeyNames,
  loadWorkerSecretsForSpawn,
  clearWorkerSecrets,
  workerSecretsFingerprintHmac,
} from './worker-secrets.js'
import * as workerSecretsModule from './worker-secrets.js'
import { randomBytes } from 'node:crypto'

describe('worker-secrets', () => {
  let dir: string
  const prevData = process.env.ROUTER_DATA_DIR
  const prevInjected = process.env.ROUTER_SECRETS_PARENT_INJECTED

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'worker-sec-'))
    process.env.ROUTER_DATA_DIR = dir
    delete process.env.ROUTER_SECRETS_PARENT_INJECTED
    setTestMasterKey(randomBytes(32))
  })

  after(() => {
    setTestMasterKey(null)
    if (prevData === undefined) delete process.env.ROUTER_DATA_DIR
    else process.env.ROUTER_DATA_DIR = prevData
    if (prevInjected === undefined) delete process.env.ROUTER_SECRETS_PARENT_INJECTED
    else process.env.ROUTER_SECRETS_PARENT_INJECTED = prevInjected
    rmSync(dir, { recursive: true, force: true })
  })

  it('stores secrets per worker and returns only key names publicly', () => {
    const a = setWorkerSecret('w1', 'OPENAI_API_KEY', 'sk-test-1')
    assert.deepEqual(a.configuredKeys, ['OPENAI_API_KEY'])
    assert.equal(a.revision, 1)

    const status = listWorkerSecretKeyNames('w1')
    assert.deepEqual(status.configuredKeys, ['OPENAI_API_KEY'])
    assert.ok(!JSON.stringify(status).includes('sk-test'))

    const spawn = loadWorkerSecretsForSpawn('w1')
    assert.equal(spawn.OPENAI_API_KEY, 'sk-test-1')

    // Isolation: other worker empty
    assert.deepEqual(listWorkerSecretKeyNames('w2').configuredKeys, [])
    assert.deepEqual(loadWorkerSecretsForSpawn('w2'), {})
  })

  it('bumps revision on change and fingerprint does not include values', () => {
    setWorkerSecret('w1', 'OPENAI_API_KEY', 'sk-a')
    const r1 = listWorkerSecretKeyNames('w1').revision
    const fp1 = workerSecretsFingerprintHmac('w1')
    setWorkerSecret('w1', 'OPENAI_API_KEY', 'sk-b')
    const r2 = listWorkerSecretKeyNames('w1').revision
    const fp2 = workerSecretsFingerprintHmac('w1')
    assert.ok(r2 > r1)
    assert.notEqual(fp1, fp2)
    assert.ok(!fp1.includes('sk-'))
  })

  it('computes revision HMAC from metadata with an explicit test-only key', () => {
    const compute = (workerSecretsModule as Record<string, unknown>).computeWorkerSecretRevisionHmac
    assert.equal(typeof compute, 'function')
    const fn = compute as (
      input: { workerId: string; configuredKeys: string[]; revision: number },
      options: { testOnlyHmacKey: Buffer },
    ) => string
    const key = Buffer.alloc(32, 7)
    const baseline = fn(
      { workerId: 'w-meta', configuredKeys: ['AGENT_API_KEY'], revision: 3 },
      { testOnlyHmacKey: key },
    )
    assert.match(baseline, /^[0-9a-f]{64}$/)
    assert.notEqual(
      baseline,
      fn(
        { workerId: 'w-meta', configuredKeys: ['AGENT_API_KEY'], revision: 4 },
        { testOnlyHmacKey: key },
      ),
    )
    assert.notEqual(
      baseline,
      fn(
        { workerId: 'w-meta', configuredKeys: ['SECOND_AGENT_TOKEN'], revision: 3 },
        { testOnlyHmacKey: key },
      ),
    )
  })

  it('loads plaintext and revision HMAC from one spawn snapshot', () => {
    setWorkerSecret('w-snapshot', 'AGENT_API_KEY', 'snapshot-value')
    const loadSnapshot = (workerSecretsModule as Record<string, unknown>)
      .loadWorkerSecretsSnapshotForSpawn
    assert.equal(typeof loadSnapshot, 'function')
    const snapshot = (
      loadSnapshot as (workerId: string) => {
        secrets: Record<string, string>
        configuredKeys: string[]
        revision: number
        revisionHmac: string
      }
    )('w-snapshot')
    assert.deepEqual(snapshot.secrets, { AGENT_API_KEY: 'snapshot-value' })
    assert.deepEqual(snapshot.configuredKeys, ['AGENT_API_KEY'])
    assert.ok(snapshot.revision > 0)
    assert.match(snapshot.revisionHmac, /^[0-9a-f]{64}$/)
    assert.equal(JSON.stringify(snapshot).includes('snapshot-value'), false)
  })

  it('rejects reserved env names', () => {
    assert.throws(() => setWorkerSecret('w1', 'PATH', 'x'), /reserved|Invalid/i)
    assert.throws(() => setWorkerSecret('w1', 'ROUTER_FOO', 'x'), /reserved|Invalid/i)
  })

  it('clear empties secrets but bumps revision', () => {
    setWorkerSecret('w3', 'ANTHROPIC_API_KEY', 'a')
    const { revision } = clearWorkerSecrets('w3')
    assert.ok(revision >= 1)
    assert.deepEqual(listWorkerSecretKeyNames('w3').configuredKeys, [])
    assert.deepEqual(loadWorkerSecretsForSpawn('w3'), {})
  })
})
