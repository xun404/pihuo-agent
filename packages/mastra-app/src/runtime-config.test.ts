import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGoalMaxRuns, resolveHttpPort, resolveMemoryLastMessages } from './runtime-config.js'

describe('runtime configuration boundaries', () => {
  it('accepts valid TCP ports and rejects malformed or out-of-range values', () => {
    assert.equal(resolveHttpPort('4119'), 4119)
    assert.equal(resolveHttpPort('65535'), 65535)
    assert.equal(resolveHttpPort(undefined), 4111)
    assert.equal(resolveHttpPort('0'), 4111)
    assert.equal(resolveHttpPort('65536'), 4111)
    assert.equal(resolveHttpPort('4111.5'), 4111)
    assert.equal(resolveHttpPort('https://attacker.example'), 4111)
  })

  it('normalizes memory history to a bounded positive integer', () => {
    assert.equal(resolveMemoryLastMessages('80'), 80)
    assert.equal(resolveMemoryLastMessages(undefined), 40)
    assert.equal(resolveMemoryLastMessages('-1'), 40)
    assert.equal(resolveMemoryLastMessages('Infinity'), 40)
    assert.equal(resolveMemoryLastMessages('4.9'), 4)
    assert.equal(resolveMemoryLastMessages('999999'), 10_000)
  })

  it('normalizes goal runs to a bounded positive integer', () => {
    assert.equal(resolveGoalMaxRuns('50'), 50)
    assert.equal(resolveGoalMaxRuns(undefined), 30)
    assert.equal(resolveGoalMaxRuns('0'), 30)
    assert.equal(resolveGoalMaxRuns('-2'), 30)
    assert.equal(resolveGoalMaxRuns('NaN'), 30)
    assert.equal(resolveGoalMaxRuns('10.8'), 10)
    assert.equal(resolveGoalMaxRuns('999999'), 1_000)
  })
})
