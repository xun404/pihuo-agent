import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./SettingsPanel.tsx', import.meta.url), 'utf8')

test('agent authentication clears terminal and transport-failure UI state', () => {
  assert.match(source, /if \(agentAuthControllerRef\.current\) return/u)
  assert.match(
    source,
    /const completed = await pollRegistryOperationUntilTerminal[\s\S]*?setAgentAuthOperation\(null\)[\s\S]*?if \(completed\.status === 'succeeded' && verifiedReadiness\)/u,
  )
  assert.match(
    source,
    /completed\.result\?\.worker\.readiness\?\.status === 'ready'[\s\S]*?completed\.result\?\.worker\.readiness\?\.status === 'degraded'/u,
  )
  assert.match(
    source,
    /catch \(error\) \{\s*if \(!controller\.signal\.aborted\) \{\s*setAgentAuthOperation\(null\)/u,
  )
})

test('closing the secret editor aborts an active submission', () => {
  assert.match(
    source,
    /const closeSecretEditor = \(\) => \{\s*secretControllerRef\.current\?\.abort\(\)\s*setSecretEditor\(null\)\s*\}/u,
  )
  assert.match(source, /onClick=\{closeSecretEditor\}/u)
  assert.match(source, /catch \(error\) \{\s*if \(!controller\.signal\.aborted\) \{\s*toastError/u)
})

test('a Registry selection never falls through to editable custom registration', () => {
  assert.match(source, /const registrationRoute = resolveWorkerRegistrationRoute\(/u)
  assert.match(source, /const isRegistryPath = registrationRoute\.kind !== 'custom'/u)
  assert.doesNotMatch(
    source,
    /const isRegistryPath = Boolean\(regSelectedId && regManifestDigest\)/u,
  )
  assert.match(source, /selectedRegistryOption && !regManifestDigest/u)
  assert.match(source, /if \(registrationRoute\.kind === 'registry_unavailable'\)/u)
  assert.match(source, /if \(registrationRoute\.kind === 'registry'\)/u)
  assert.doesNotMatch(source, /if \(isRegistryPath && selectedRegistryOption\)/u)
})

test('Registry catalog updates are explicit and show active local snapshot metadata', () => {
  assert.match(source, /catalog: workerRegistryCatalog/u)
  assert.match(source, /checking: workerRegistryChecking/u)
  assert.match(source, /checkForUpdates: checkWorkerRegistryUpdates/u)
  assert.match(source, /workers\.registryCheckUpdates/u)
  assert.match(source, /workerRegistryCatalog\?\.source/u)
  assert.match(source, /workerRegistryCatalog\?\.fetchedAt/u)
  assert.match(source, /workerRegistryCatalog\?\.agentCount/u)
  assert.doesNotMatch(source, /getWorkerRegistry\(signal, refresh\)/u)
})
