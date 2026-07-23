import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./TeamTemplateManager.tsx', import.meta.url), 'utf8')

test('Team template UI saves, manages, previews, and replaces the current Team', () => {
  assert.match(source, /api\.createTeamTemplate/u)
  assert.match(source, /api\.updateTeamTemplate/u)
  assert.match(source, /api\.deleteTeamTemplate/u)
  assert.match(source, /api\.previewTeamTemplateApplication/u)
  assert.match(source, /api\.applyTeamTemplate/u)
  assert.match(source, /openJobCount > 0/u)
  assert.match(source, /expectedTeamRevision: currentPreview\.teamRevision/u)
})

test('Team template UI requires explicit Worker substitution for unresolved members', () => {
  assert.match(source, /member\.issueCode/u)
  assert.match(source, /setWorkerMapping/u)
  assert.match(source, /setModelMapping/u)
  assert.match(source, /member\.instructions/u)
  assert.match(source, /team\.chooseWorker/u)
  assert.match(source, /team-mapping-card/u)
})
