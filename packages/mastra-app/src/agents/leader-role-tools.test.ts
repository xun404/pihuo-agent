import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Leader manages templates and dispatches Chat Team members', () => {
  const source = readFileSync(fileURLToPath(new URL('./leader-agent.ts', import.meta.url)), 'utf8')
  const toolsStart = source.indexOf('tools: {')
  const toolsEnd = source.indexOf('\n  },', toolsStart)
  assert.notEqual(toolsStart, -1)
  assert.notEqual(toolsEnd, -1)
  const tools = source.slice(toolsStart, toolsEnd)

  for (const name of [
    'listTeamTool',
    'listWorkersTool',
    'addTeamMemberTool',
    'updateTeamMemberTool',
    'archiveTeamMemberTool',
    'resetTeamMemberSessionTool',
    'dispatchTeamMemberTool',
    'listTeamTemplatesTool',
    'saveTeamTemplateTool',
    'applyTeamTemplateTool',
    'deleteTeamTemplateTool',
  ]) {
    assert.match(tools, new RegExp(`\\b${name}\\b`, 'u'))
  }
  assert.doesNotMatch(tools, /\bdispatchWorkerTool\b/u)
})

test('Leader instructions consume the one-time role-review RequestContext', () => {
  const source = readFileSync(fileURLToPath(new URL('./leader-agent.ts', import.meta.url)), 'utf8')

  assert.match(source, /buildLeaderInstructions/u)
  assert.match(source, /normalizePromptSettings/u)
  assert.match(source, /roleReviewPending/u)
  assert.match(source, /bootstrappedRoleCount/u)
})

test('Leader mounts TaskSignalProvider so the task list persists across turns', () => {
  const source = readFileSync(fileURLToPath(new URL('./leader-agent.ts', import.meta.url)), 'utf8')

  assert.match(source, /from '@mastra\/core\/signals'/u)
  assert.match(source, /TaskSignalProvider/u)
  assert.match(source, /signals:\s*\[\s*new TaskSignalProvider\(\)\s*\]/u)
})
