import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWorkerModelOptions, shouldApplyScopedModelResponse } from './worker-model-view.js'

test('project-scoped catalog replaces the global worker shortlist when search is empty', () => {
  const scoped = [{ modelId: 'project/model', name: 'Project model' }]
  const global = [{ modelId: 'global/model', name: 'Global model' }]

  assert.deepEqual(resolveWorkerModelOptions('', undefined, scoped, global), scoped)
})

test('an unfetched project scope never falls back to a global worker shortlist', () => {
  const global = [{ modelId: 'global/model', name: 'Global model' }]
  assert.deepEqual(resolveWorkerModelOptions('', undefined, undefined, global, false), [])
})

test('search results take precedence only while a search query is active', () => {
  const search = [{ modelId: 'search/model', name: 'Search model' }]
  const scoped = [{ modelId: 'project/model', name: 'Project model' }]

  assert.deepEqual(resolveWorkerModelOptions('search', search, scoped, []), search)
  assert.deepEqual(resolveWorkerModelOptions('', search, scoped, []), scoped)
})

test('responses cannot cross project or request-generation boundaries', () => {
  assert.equal(shouldApplyScopedModelResponse('project-a', 'project-a', 2, 2), true)
  assert.equal(shouldApplyScopedModelResponse('project-a', 'project-b', 2, 2), false)
  assert.equal(shouldApplyScopedModelResponse('project-a', 'project-a', 1, 2), false)
})
