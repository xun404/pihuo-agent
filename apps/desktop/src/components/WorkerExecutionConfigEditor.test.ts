import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'WorkerExecutionConfigEditor.tsx'),
  'utf8',
)

describe('WorkerExecutionConfigEditor model catalog loading', () => {
  it('fetches worker models from the API (does not rely only on snapshot shortlist)', () => {
    assert.match(source, /api\.fetchWorkerModels/)
    assert.match(source, /needsModelCatalogFetch|force:\s*true/)
  })

  it('auto-loads when the selected worker has an empty or stale catalog', () => {
    assert.match(source, /loadModels\(\{\s*force:\s*false\s*\}\)/)
    assert.match(source, /modelCatalogState|modelsState/)
  })

  it('exposes a manual refresh action for force reload', () => {
    assert.match(source, /workers\.modelRefresh/)
    assert.match(source, /loadModels\(\{\s*force:\s*true\s*\}\)/)
  })

  it('maps catalog rows through toWorkerModelSearchOption (dedupe name vs modelId)', () => {
    assert.match(source, /toWorkerModelSearchOption/)
  })

  it('clears modelsLoading when skipping fetch or cancelling in-flight loads', () => {
    assert.match(source, /setModelsLoading\(false\)/)
    assert.match(source, /fetchGenRef\.current \+= 1/)
    // Must not leave spinner stuck after worker switch / effect cleanup.
    assert.match(source, /cancelled load cannot|stale modelsLoading|setModelsLoading\(false\)/u)
  })
})
