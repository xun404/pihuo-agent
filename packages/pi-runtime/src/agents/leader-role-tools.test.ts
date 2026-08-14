import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Leader session factory mounts PiHuo team tools', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../leader/pihuo-tools.ts', import.meta.url)),
    'utf8',
  )
  for (const name of [
    'listTeamTool',
    'listWorkersTool',
    'addTeamMemberTool',
    'dispatchTeamMemberTool',
    'listTeamTemplatesTool',
  ]) {
    assert.match(source, new RegExp(`\\b${name}\\b`, 'u'))
  }
})

test('Leader instructions consume role-review and prompt settings', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./leader-instructions.ts', import.meta.url)),
    'utf8',
  )
  assert.match(source, /roleReviewPending/u)
  assert.match(source, /bootstrappedRoleCount/u)
  assert.match(source, /You are the PiHuo Leader/u)
  assert.doesNotMatch(source, /You are an expert coding assistant operating inside pi/u)
})
