import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as secureSecretsModule from './secure-secrets.js'
import { tryAcquireProcessFileLock } from './process-file-lock.js'
import {
  clearWorkerSecrets,
  listWorkerSecretKeyNames,
  loadWorkerSecretsForSpawn,
  setWorkerSecret,
} from './worker-secrets.js'

const CAPABILITY_ENV = 'PIHUO_AGENT_WORKER_SECRETS_KEY'

function withWorkerSecretEnvironment(
  run: (context: { dir: string; masterKey: Buffer }) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), 'worker-secrets-boundary-'))
  const previousDir = process.env.PIHUO_AGENT_DATA_DIR
  const previousInjected = process.env.PIHUO_AGENT_SECRETS_PARENT_INJECTED
  const previousCapability = process.env[CAPABILITY_ENV]
  const masterKey = randomBytes(32)
  try {
    process.env.PIHUO_AGENT_DATA_DIR = dir
    delete process.env.PIHUO_AGENT_SECRETS_PARENT_INJECTED
    delete process.env[CAPABILITY_ENV]
    secureSecretsModule.setTestMasterKey(masterKey)
    run({ dir, masterKey })
  } finally {
    secureSecretsModule.setTestMasterKey(null)
    if (previousDir === undefined) delete process.env.PIHUO_AGENT_DATA_DIR
    else process.env.PIHUO_AGENT_DATA_DIR = previousDir
    if (previousInjected === undefined) delete process.env.PIHUO_AGENT_SECRETS_PARENT_INJECTED
    else process.env.PIHUO_AGENT_SECRETS_PARENT_INJECTED = previousInjected
    if (previousCapability === undefined) delete process.env[CAPABILITY_ENV]
    else process.env[CAPABILITY_ENV] = previousCapability
    rmSync(dir, { recursive: true, force: true })
  }
}

test('parent and trusted API child share the worker-secret encrypted namespace', () => {
  withWorkerSecretEnvironment(({ masterKey }) => {
    setWorkerSecret('worker-a', 'AGENT_API_KEY', 'parent-value')

    const keyForChild = (secureSecretsModule as Record<string, unknown>).getWorkerSecretsKeyForChild
    assert.equal(typeof keyForChild, 'function')
    const capability = (keyForChild as () => string)()
    assert.equal(Buffer.from(capability, 'base64').length, 32)

    secureSecretsModule.setTestMasterKey(null)
    process.env.PIHUO_AGENT_SECRETS_PARENT_INJECTED = '1'
    process.env[CAPABILITY_ENV] = capability
    assert.deepEqual(loadWorkerSecretsForSpawn('worker-a'), {
      AGENT_API_KEY: 'parent-value',
    })

    const publicStatus = setWorkerSecret('worker-a', 'SECOND_AGENT_TOKEN', 'child-value')
    assert.deepEqual(publicStatus.configuredKeys, ['AGENT_API_KEY', 'SECOND_AGENT_TOKEN'])
    assert.equal(JSON.stringify(publicStatus).includes('parent-value'), false)
    assert.equal(JSON.stringify(publicStatus).includes('child-value'), false)

    delete process.env.PIHUO_AGENT_SECRETS_PARENT_INJECTED
    delete process.env[CAPABILITY_ENV]
    secureSecretsModule.setTestMasterKey(masterKey)
    assert.deepEqual(loadWorkerSecretsForSpawn('worker-a'), {
      AGENT_API_KEY: 'parent-value',
      SECOND_AGENT_TOKEN: 'child-value',
    })
  })
})

test('injected child fails closed for missing, malformed, or wrong capabilities', () => {
  withWorkerSecretEnvironment(({ dir }) => {
    setWorkerSecret('worker-a', 'AGENT_API_KEY', 'preserve-me')
    const encryptedPath = join(dir, 'worker-secrets.enc')
    const original = readFileSync(encryptedPath)

    secureSecretsModule.setTestMasterKey(null)
    process.env.PIHUO_AGENT_SECRETS_PARENT_INJECTED = '1'
    delete process.env[CAPABILITY_ENV]
    assert.throws(() => listWorkerSecretKeyNames('worker-a'), /capability/i)

    process.env[CAPABILITY_ENV] = randomBytes(31).toString('base64')
    assert.throws(() => listWorkerSecretKeyNames('worker-a'), /32 bytes|capability/i)

    process.env[CAPABILITY_ENV] = randomBytes(32).toString('base64')
    assert.throws(() => setWorkerSecret('worker-a', 'SECOND_AGENT_TOKEN', 'must-not-write'))
    assert.deepEqual(readFileSync(encryptedPath), original)
  })
})

test('worker-secret mutations fail closed while another process owns the file lock', () => {
  withWorkerSecretEnvironment(({ dir }) => {
    setWorkerSecret('worker-locked', 'AGENT_API_KEY', 'preserve-me')
    const encryptedPath = join(dir, 'worker-secrets.enc')
    const original = readFileSync(encryptedPath)
    const lock = tryAcquireProcessFileLock(`${encryptedPath}.lock`)
    assert.ok(lock)
    try {
      assert.throws(
        () => setWorkerSecret('worker-locked', 'SECOND_AGENT_TOKEN', 'must-not-write'),
        /mutation.*busy|retry/i,
      )
      assert.deepEqual(readFileSync(encryptedPath), original)
    } finally {
      lock?.release()
    }
  })
})

test('clearing an unknown Worker does not materialize an empty encrypted store', () => {
  withWorkerSecretEnvironment(({ dir }) => {
    assert.deepEqual(clearWorkerSecrets('unknown-worker'), { revision: 0 })
    assert.throws(() => readFileSync(join(dir, 'worker-secrets.enc')), /ENOENT/)
  })
})
