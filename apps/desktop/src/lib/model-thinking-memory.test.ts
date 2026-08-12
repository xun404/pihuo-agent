import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MODEL_THINKING_MEMORY_STORAGE_KEY,
  loadModelThinkingMemory,
  rememberModelThinkingIntensity,
  resolveModelThinkingIntensity,
} from './model-thinking-memory.js'

function memoryStorage(seed: string | null = null) {
  const values = new Map<string, string>()
  if (seed != null) values.set(MODEL_THINKING_MEMORY_STORAGE_KEY, seed)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

test('stores explicit thinking choices by model id', () => {
  const storage = memoryStorage('{"provider/model-a":"high","bad":"turbo"}')

  rememberModelThinkingIntensity('provider/model-b', 'low', storage)

  assert.deepEqual(loadModelThinkingMemory(storage), {
    'provider/model-a': 'high',
    'provider/model-b': 'low',
  })
})

test('uses remembered intensity only when the current model still supports it', () => {
  const memory = { 'provider/model-a': 'high' as const }

  assert.equal(
    resolveModelThinkingIntensity('provider/model-a', ['low', 'high'], { memory }),
    'high',
  )
  assert.equal(
    resolveModelThinkingIntensity('provider/model-a', ['off', 'medium'], { memory }),
    'medium',
  )
})

test('a later explicit choice becomes the default for the next chat on that model', () => {
  const storage = memoryStorage()

  rememberModelThinkingIntensity('provider/default-model', 'max', storage)
  assert.equal(
    resolveModelThinkingIntensity('provider/default-model', ['off', 'low', 'high', 'max'], {
      memory: loadModelThinkingMemory(storage),
    }),
    'max',
  )

  rememberModelThinkingIntensity('provider/default-model', 'low', storage)
  assert.equal(
    resolveModelThinkingIntensity('provider/default-model', ['off', 'low', 'high', 'max'], {
      memory: loadModelThinkingMemory(storage),
    }),
    'low',
  )
})

test('uses the tier calculator when this model has no remembered setting', () => {
  assert.equal(
    resolveModelThinkingIntensity('provider/model-a', ['off', 'high'], { memory: {} }),
    'high',
  )
})
