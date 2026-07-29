import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getLeaderControllerConfig } from './controller.js'

function modeInstructions(id: 'ask' | 'plan' | 'build' | 'review'): string {
  const mode = getLeaderControllerConfig().modes.find((candidate) => candidate.id === id)
  assert.ok(mode, `missing ${id} mode`)
  return mode.instructions
}

describe('Leader controller modes', () => {
  it('exposes the four supported modes in order', () => {
    assert.deepEqual(
      getLeaderControllerConfig().modes.map((mode) => mode.id),
      ['ask', 'plan', 'build', 'review'],
    )
  })

  it('delegates ask-mode answers to a Team worker', () => {
    const instructions = modeInstructions('ask')

    assert.match(instructions, /Coordinate an appropriate Team worker/u)
    assert.match(instructions, /Do not perform the technical work yourself/u)
  })

  it('delegates plan-mode analysis and excludes implementation roles', () => {
    const instructions = modeInstructions('plan')

    assert.match(instructions, /Coordinate plan\/research workers/u)
    assert.match(instructions, /Do not dispatch implementation roles in plan mode/u)
    assert.match(instructions, /Do not perform the technical work yourself/u)
  })

  it('delegates build-mode implementation without adding Leader conclusions', () => {
    const instructions = modeInstructions('build')

    assert.match(instructions, /Coordinate coder workers/u)
    assert.match(instructions, /Relay Worker outputs without adding technical conclusions/u)
    assert.match(instructions, /Do not perform the technical work yourself/u)
  })

  it('delegates review-mode assessment and only relays findings', () => {
    const instructions = modeInstructions('review')

    assert.match(instructions, /Coordinate review workers to assess/u)
    assert.match(instructions, /relay their findings/u)
    assert.match(instructions, /Do not perform the technical work yourself/u)
  })
})
