import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Owner exposes probe-before-persist custom ACP registration and retires builtin detection', () => {
  const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')

  assert.match(owner, /\/api\/workers\/custom\/register/u)
  assert.match(owner, /registerCustomAcpWorker/u)
  assert.doesNotMatch(owner, /\/api\/workers\/detect/u)
  assert.doesNotMatch(owner, /detectAcpWorkers/u)
  assert.doesNotMatch(owner, /applyDetectionToWorkers/u)
})
