import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadSettings, loadSecrets, saveSettings, setSecret } from './secure-secrets.js'

test('a corrupt encrypted payload is never overwritten by a later mutation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'router-secrets-durability-'))
  const previousDir = process.env.ROUTER_DATA_DIR
  const previousSecret = process.env.ROUTER_CREDENTIAL_SECRET
  const previousParentInjection = process.env.ROUTER_SECRETS_PARENT_INJECTED
  const originalConsoleError = console.error

  try {
    process.env.ROUTER_DATA_DIR = dir
    // Pin the derived master key so the test is deterministic across machines.
    process.env.ROUTER_CREDENTIAL_SECRET = 'test-durability-key'
    delete process.env.ROUTER_SECRETS_PARENT_INJECTED
    setSecret('FIRST_API_KEY', 'original-secret')

    const encryptedPath = join(dir, 'secrets.enc')
    assert.equal(existsSync(encryptedPath), true)
    writeFileSync(encryptedPath, Buffer.from('corrupt-ciphertext'))
    const corruptBytes = readFileSync(encryptedPath)
    console.error = () => {}

    assert.deepEqual(loadSecrets(), {})
    assert.throws(() => setSecret('SECOND_API_KEY', 'must-not-replace'))
    assert.deepEqual(readFileSync(encryptedPath), corruptBytes)
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.startsWith('secrets.enc.tmp.')),
      [],
    )
  } finally {
    console.error = originalConsoleError
    if (previousDir === undefined) delete process.env.ROUTER_DATA_DIR
    else process.env.ROUTER_DATA_DIR = previousDir
    if (previousSecret === undefined) delete process.env.ROUTER_CREDENTIAL_SECRET
    else process.env.ROUTER_CREDENTIAL_SECRET = previousSecret
    if (previousParentInjection === undefined) delete process.env.ROUTER_SECRETS_PARENT_INJECTED
    else process.env.ROUTER_SECRETS_PARENT_INJECTED = previousParentInjection
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt settings file is never silently replaced from defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'router-settings-durability-'))
  const previousDir = process.env.ROUTER_DATA_DIR

  try {
    process.env.ROUTER_DATA_DIR = dir
    const settingsPath = join(dir, 'settings.json')
    writeFileSync(settingsPath, '{invalid-json')
    const corruptBytes = readFileSync(settingsPath)

    assert.equal(typeof loadSettings().leaderModel, 'string')
    assert.throws(() => saveSettings({ leaderModel: 'openai/gpt-5.5' }))
    assert.deepEqual(readFileSync(settingsPath), corruptBytes)
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.startsWith('settings.json.tmp.')),
      [],
    )
  } finally {
    if (previousDir === undefined) delete process.env.ROUTER_DATA_DIR
    else process.env.ROUTER_DATA_DIR = previousDir
    rmSync(dir, { recursive: true, force: true })
  }
})
