import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deriveMasterKey } from './master-key.js'

function sha256(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest()
}

describe('deriveMasterKey', () => {
  it('returns a 32-byte key', () => {
    const key = deriveMasterKey({}, 'darwin', '/tmp/fake-home')
    assert.equal(key.length, 32)
  })

  it('SWARMDESK_AGENT_CREDENTIAL_SECRET override wins and is deterministic', () => {
    const a = deriveMasterKey({ SWARMDESK_AGENT_CREDENTIAL_SECRET: 'my-secret' }, 'darwin', '/tmp/h1')
    const b = deriveMasterKey({ SWARMDESK_AGENT_CREDENTIAL_SECRET: 'my-secret' }, 'linux', '/tmp/h2')
    assert.deepEqual(a, b)
    assert.deepEqual(a, sha256('my-secret'))
  })

  it('whitespace-only SWARMDESK_AGENT_CREDENTIAL_SECRET is ignored', () => {
    const a = deriveMasterKey({ SWARMDESK_AGENT_CREDENTIAL_SECRET: '   ' }, 'darwin', '/tmp/h')
    const b = deriveMasterKey({}, 'darwin', '/tmp/h')
    assert.deepEqual(a, b)
  })

  it('derives from platform + username + homedir when no override', () => {
    // The derived identity string is `swarmdesk-agent:<platform>:<username>:<home>`.
    // We cannot easily stub userInfo() here, so assert the homedir/platform
    // sensitivity by comparing two homes on the same platform.
    const a = deriveMasterKey({}, 'darwin', '/tmp/home-a')
    const b = deriveMasterKey({}, 'darwin', '/tmp/home-b')
    assert.notDeepEqual(a, b, 'different homedirs must yield different keys')
  })

  it('is deterministic for identical inputs', () => {
    const a = deriveMasterKey({}, 'darwin', '/tmp/same-home')
    const b = deriveMasterKey({}, 'darwin', '/tmp/same-home')
    assert.deepEqual(a, b)
  })

  it('different platforms yield different keys for the same home', () => {
    const a = deriveMasterKey({}, 'darwin', '/tmp/home-x')
    const b = deriveMasterKey({}, 'linux', '/tmp/home-x')
    assert.notDeepEqual(a, b)
  })
})
