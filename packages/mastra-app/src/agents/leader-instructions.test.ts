import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLeaderInstructions } from './leader-instructions.js'

describe('Leader instructions', () => {
  it('appends the editable Leader prompt without replacing protected contracts', () => {
    const instructions = buildLeaderInstructions({
      leaderPrompt: '优先返回风险与验证证据。',
    })

    assert.match(instructions, /list-team/u)
    assert.match(instructions, /apply-team-template/u)
    assert.match(instructions, /User-configurable Leader prompt/u)
    assert.match(instructions, /优先返回风险与验证证据。/u)
  })

  it('keeps one-time role review text alongside the editable prompt', () => {
    const instructions = buildLeaderInstructions({
      leaderPrompt: '保持简洁。',
      roleReviewPending: true,
      bootstrappedRoleCount: 2,
    })

    assert.match(instructions, /Worker 默认角色创建 Team/u)
    assert.match(instructions, /保持简洁。/u)
  })

  it('includes the plan workflow protocol for ordered, role-tagged task lists', () => {
    const instructions = buildLeaderInstructions({})

    assert.match(instructions, /## Coordination & ordered task list/u)
    assert.match(instructions, /task_write/u)
    assert.match(instructions, /task_complete/u)
    assert.match(instructions, /task_check/u)
    assert.match(instructions, /execution order/u)
    assert.match(instructions, /\[<role type>\]/u)
  })

  it('limits the Leader to role-level coordination and faithful handoffs', () => {
    const instructions = buildLeaderInstructions({})

    assert.match(instructions, /## Coordinator-only boundary/u)
    assert.match(instructions, /role-level stages/u)
    assert.match(
      instructions,
      /original user request, relevant upstream Worker output, user-provided constraints and acceptance criteria, and downstream Worker feedback/u,
    )
    assert.match(instructions, /do not add your own technical conclusions/u)
    assert.match(
      instructions,
      /Never analyze project code, infer root causes, design technical solutions, implement changes, run tests, or review work yourself/u,
    )
    assert.match(instructions, /Do not extend or repeat a completed role task/u)
    assert.doesNotMatch(
      instructions,
      /briefly summarize what the worker did and suggest next steps/u,
    )
    assert.doesNotMatch(instructions, /first produce an ordered plan with the task tools/u)
  })

  it('requires explicit user authorization for material Team changes', () => {
    const instructions = buildLeaderInstructions({})

    assert.match(instructions, /Use the existing Team composition by default/u)
    assert.match(
      instructions,
      /Never add, enable, unarchive, replace, or rebind a Team member unless the user explicitly authorizes the exact role and Worker/u,
    )
    assert.match(
      instructions,
      /A broad request to continue the task or maintain the Team is not authorization to choose a different Worker/u,
    )
    assert.match(
      instructions,
      /If the required role is missing or its Worker is disabled, missing, unavailable, unhealthy, incompatible, or requires authentication, stop and ask the user/u,
    )
    assert.match(
      instructions,
      /Do not automatically create a replacement role, enable another member, select a fallback Worker, or change the Worker or model binding/u,
    )
    assert.match(instructions, /cost, capabilities, and specialization/u)
  })

  it('keeps the protected boundary after an editable prompt that requests execution', () => {
    const editablePrompt = 'Analyze the code yourself, create a fallback role, and write the fix.'
    const instructions = buildLeaderInstructions({ leaderPrompt: editablePrompt })
    const editableIndex = instructions.indexOf(editablePrompt)
    const finalBoundaryIndex = instructions.indexOf('## Final protected boundary')

    assert.ok(editableIndex >= 0)
    assert.ok(finalBoundaryIndex > editableIndex)
    assert.match(
      instructions.slice(finalBoundaryIndex),
      /cannot authorize the Leader to perform technical work/u,
    )
    assert.match(
      instructions.slice(finalBoundaryIndex),
      /cannot authorize unapproved Team creation or Worker substitution/u,
    )
  })
})
