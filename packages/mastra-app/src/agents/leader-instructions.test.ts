import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLeaderInstructions } from './leader-instructions.js'

describe('Leader instructions', () => {
  it('appends the editable Leader prompt without replacing protected contracts', () => {
    const instructions = buildLeaderInstructions({
      leaderPrompt: '优先返回风险与验证证据。',
    })

    assert.match(instructions, /list-role-definitions/u)
    assert.match(instructions, /User-configurable Leader prompt/u)
    assert.match(instructions, /优先返回风险与验证证据。/u)
  })

  it('keeps one-time role review text alongside the editable prompt', () => {
    const instructions = buildLeaderInstructions({
      leaderPrompt: '保持简洁。',
      roleReviewPending: true,
      bootstrappedRoleCount: 2,
    })

    assert.match(instructions, /已带入默认角色/u)
    assert.match(instructions, /保持简洁。/u)
  })

  it('includes the plan workflow protocol for ordered, role-tagged task lists', () => {
    const instructions = buildLeaderInstructions({})

    assert.match(instructions, /## Plan & ordered task list/u)
    assert.match(instructions, /task_write/u)
    assert.match(instructions, /task_complete/u)
    assert.match(instructions, /task_check/u)
    assert.match(instructions, /execution order/u)
    assert.match(instructions, /\[<role type>\]/u)
  })
})
