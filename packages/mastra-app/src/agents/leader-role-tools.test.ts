import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Leader manages and dispatches Chat role definitions instead of global Worker routing', () => {
  const source = readFileSync(fileURLToPath(new URL('./leader-agent.ts', import.meta.url)), 'utf8')
  const toolsStart = source.indexOf('tools: {')
  const toolsEnd = source.indexOf('\n  },', toolsStart)
  assert.notEqual(toolsStart, -1)
  assert.notEqual(toolsEnd, -1)
  const tools = source.slice(toolsStart, toolsEnd)

  for (const name of [
    'listRoleDefinitionsTool',
    'listWorkersTool',
    'createRoleDefinitionTool',
    'updateRoleDefinitionTool',
    'archiveRoleDefinitionTool',
    'resetRoleSessionTool',
    'dispatchRoleTool',
  ]) {
    assert.match(tools, new RegExp(`\\b${name}\\b`, 'u'))
  }
  assert.doesNotMatch(tools, /\bdispatchWorkerTool\b/u)
})

test('Leader instructions consume the one-time role-review RequestContext', () => {
  const source = readFileSync(fileURLToPath(new URL('./leader-agent.ts', import.meta.url)), 'utf8')

  assert.match(source, /buildRoleReviewInstruction/u)
  assert.match(source, /roleReviewPending/u)
  assert.match(source, /bootstrappedRoleCount/u)
})
