import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { coalesceAssistantTurns } from './coalesce-assistant-turns.js'

describe('coalesceAssistantTurns', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(coalesceAssistantTurns([]), [])
  })

  it('passes through a single assistant message unchanged', () => {
    const msgs = [
      { id: 'user-1', role: 'user' as const, parts: [{ type: 'text', text: 'Hi' }] },
      {
        id: 'asst-1',
        role: 'assistant' as const,
        parts: [{ type: 'text', text: 'Hello!' }],
      },
    ]
    const result = coalesceAssistantTurns(msgs)
    assert.equal(result.length, 2)
    assert.equal(result[1].id, 'asst-1')
  })

  it('coalesces multiple consecutive assistant messages into one', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text', text: 'Build a game' }] },
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [
          { type: 'reasoning', reasoning: 'Let me plan' },
          { type: 'text', text: 'Planning...' },
          { type: 'tool-invocation', toolInvocation: { toolName: 'task_write' } },
          { type: 'step-start' },
        ],
      },
      {
        id: 'a2',
        role: 'assistant' as const,
        parts: [
          { type: 'reasoning', reasoning: 'Now dispatch coder' },
          { type: 'text', text: 'Dispatching coder...' },
          { type: 'tool-invocation', toolInvocation: { toolName: 'dispatchRoleTool' } },
          { type: 'step-start' },
        ],
      },
      {
        id: 'a3',
        role: 'assistant' as const,
        parts: [
          { type: 'reasoning', reasoning: 'Done!' },
          { type: 'text', text: 'All set.' },
        ],
      },
      { id: 'u2', role: 'user' as const, parts: [{ type: 'text', text: 'Great' }] },
    ]
    const result = coalesceAssistantTurns(msgs)
    // user-1, merged-assistant, user-2
    assert.equal(result.length, 3)
    assert.equal(result[1].id, 'a1') // first assistant id preserved
    assert.equal(result[1].role, 'assistant')
    // All parts merged
    const merged = result[1]
    assert.equal(merged.parts!.length, 10) // a1(4) + a2(4) + a3(2) = 10
    // Part type sequence should be preserved
    assert.equal((merged.parts![0] as { type: string }).type, 'reasoning')
    assert.equal((merged.parts![3] as { type: string }).type, 'step-start')
    assert.equal((merged.parts![4] as { type: string }).type, 'reasoning') // a2's first
    assert.equal((merged.parts![9] as { type: string }).type, 'text')
  })

  it('handles multiple turns with coalescing', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      { id: 'a1', role: 'assistant' as const, parts: [{ type: 'text' }] },
      { id: 'a2', role: 'assistant' as const, parts: [{ type: 'text' }] },
      { id: 'u2', role: 'user' as const, parts: [{ type: 'text' }] },
      { id: 'a3', role: 'assistant' as const, parts: [{ type: 'text' }] },
      { id: 'a4', role: 'assistant' as const, parts: [{ type: 'text' }] },
      { id: 'a5', role: 'assistant' as const, parts: [{ type: 'text' }] },
    ]
    const result = coalesceAssistantTurns(msgs)
    assert.equal(result.length, 4) // u1, merged(a1+a2), u2, merged(a3+a4+a5)
    assert.equal(result[1].id, 'a1')
    assert.equal(result[1].parts!.length, 2) // a1 + a2
    assert.equal(result[3].id, 'a3')
    assert.equal(result[3].parts!.length, 3) // a3 + a4 + a5
  })

  it('preserves metadata from subsequent messages (last writer wins)', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [{ type: 'text' }],
        metadata: { foo: 'bar', budget: 1 },
      },
      {
        id: 'a2',
        role: 'assistant' as const,
        parts: [{ type: 'text' }],
        metadata: { budget: 2, extra: 'yes' },
      },
    ]
    const result = coalesceAssistantTurns(msgs)
    const merged = result[1]
    assert.equal(merged.metadata!.foo, 'bar') // carried from a1
    assert.equal(merged.metadata!.budget, 2) // overwritten by a2 (last wins)
    assert.equal(merged.metadata!.extra, 'yes') // added by a2
  })

  it('handles turn-ending at a non-assistant role', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      { id: 'a1', role: 'assistant' as const, parts: [{ type: 'text' }] },
      { id: 'a2', role: 'assistant' as const, parts: [{ type: 'text' }] },
      { id: 'sys1', role: 'system' as const, parts: [{ type: 'text' }] },
      { id: 'a3', role: 'assistant' as const, parts: [{ type: 'text' }] },
    ]
    const result = coalesceAssistantTurns(msgs)
    // u1, merged(a1+a2), sys1, a3
    assert.equal(result.length, 4)
    assert.equal(result[1].id, 'a1')
    assert.equal(result[1].parts!.length, 2)
    // a3 is part of a new turn after system message
    assert.equal(result[3].id, 'a3')
    assert.equal(result[3].parts!.length, 1)
  })

  it('passes through messages with no assistant role', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      { id: 'sys1', role: 'system' as const, parts: [{ type: 'text' }] },
    ]
    const result = coalesceAssistantTurns(msgs)
    assert.equal(result.length, 2)
    assert.equal(result[0].id, 'u1')
    assert.equal(result[1].id, 'sys1')
  })

  it('includes budget marker part when merged into turn', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      { id: 'a1', role: 'assistant' as const, parts: [{ type: 'text', text: 'Working...' }] },
      { id: 'a2', role: 'assistant' as const, parts: [{ type: 'text', text: 'Final step' }] },
      {
        id: 'budget-marker',
        role: 'assistant' as const,
        parts: [
          {
            type: 'data-leader-step-budget',
            data: { runId: 'run-1', maxSteps: 20, steps: 20, finishReason: 'tool-result-incomplete' },
          },
        ],
        metadata: { leaderStepBudget: { runId: 'run-1', steps: 20 } },
      },
    ]
    const result = coalesceAssistantTurns(msgs)
    assert.equal(result.length, 2) // user + merged
    const merged = result[1]
    assert.equal(merged.parts!.length, 3) // a1(1) + a2(1) + budget(1)
    const lastPart = merged.parts![merged.parts!.length - 1] as {
      type: string
      data?: { runId: string }
    }
    assert.equal(lastPart.type, 'data-leader-step-budget')
    assert.equal(lastPart.data?.runId, 'run-1')
    // Metadata merged from budget marker
    assert.deepEqual(merged.metadata!.leaderStepBudget, { runId: 'run-1', steps: 20 })
  })

  it('preserves earlier assistant metadata while budget marker wins its own keys', () => {
    // The budget marker is the LAST assistant message in a turn. Its metadata
    // must win for its own keys (leaderStepBudget) while not clobbering
    // unrelated keys set by earlier assistant messages in the same turn.
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [{ type: 'text' }],
        metadata: { model: 'glm-5', turnIndex: 0 },
      },
      {
        id: 'a2',
        role: 'assistant' as const,
        parts: [{ type: 'text' }],
        metadata: { turnIndex: 1 },
      },
      {
        id: 'budget',
        role: 'assistant' as const,
        parts: [{ type: 'data-leader-step-budget', data: { runId: 'r' } }],
        metadata: { leaderStepBudget: { runId: 'r', steps: 20 } },
      },
    ]
    const result = coalesceAssistantTurns(msgs)
    assert.equal(result.length, 2)
    const merged = result[1]
    assert.equal(merged.metadata!.model, 'glm-5') // never overwritten — only a1 had it
    assert.equal(merged.metadata!.turnIndex, 1) // last writer wins (a2)
    assert.deepEqual(merged.metadata!.leaderStepBudget, { runId: 'r', steps: 20 }) // from budget marker
  })

  it('handles trailing assistant messages without a following user message', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      { id: 'a1', role: 'assistant' as const, parts: [{ type: 'text' }] },
      { id: 'a2', role: 'assistant' as const, parts: [{ type: 'text' }] },
    ]
    const result = coalesceAssistantTurns(msgs)
    assert.equal(result.length, 2) // u1, merged(a1+a2)
    assert.equal(result[1].parts!.length, 2)
  })

  it('handles messages with missing parts arrays', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      { id: 'a1', role: 'assistant' as const },
      { id: 'a2', role: 'assistant' as const, parts: [{ type: 'text' }] },
    ]
    const result = coalesceAssistantTurns(msgs)
    assert.equal(result.length, 2)
    // a1 had no parts (treated as empty), a2 adds one
    assert.equal(result[1].parts!.length, 1)
  })

  it('handles data-signal parts that are part of assistant messages (they end up in merged)', () => {
    const msgs = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' }] },
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [
          { type: 'text', text: 'Step 1' },
          { type: 'step-start' },
          { type: 'data-signal', data: { tagName: 'task-list-update' } },
        ],
      },
      {
        id: 'a2',
        role: 'assistant' as const,
        parts: [
          { type: 'text', text: 'Step 2' },
          { type: 'data-signal', data: { tagName: 'task-list-update' } },
        ],
      },
    ]
    const result = coalesceAssistantTurns(msgs)
    assert.equal(result.length, 2)
    assert.equal(result[1].parts!.length, 5) // a1(3) + a2(2)
  })
})
