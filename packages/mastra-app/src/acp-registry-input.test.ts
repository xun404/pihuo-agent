import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertRegistryCandidateInput,
  assertRegistryInstallationId,
  assertRegistryRegistrationInput,
  assertRegistrySecretInput,
  assertRegistryWorkerId,
} from './acp-registry-input.js'

describe('Registry API input validation', () => {
  const valid = {
    registryId: 'github-copilot-cli',
    version: '1.2.3',
    distribution: 'npx' as const,
    manifestDigest: `sha256:${'a'.repeat(64)}`,
  }

  it('accepts bounded catalog identities and an optional strict trust timestamp', () => {
    assert.doesNotThrow(() => assertRegistryCandidateInput(valid))
    assert.doesNotThrow(() =>
      assertRegistryCandidateInput({
        ...valid,
        distribution: 'binary',
        trust: {
          explicitNoSha: true,
          acceptedAt: '2026-07-17T02:03:04.000Z',
        },
      }),
    )
    assert.doesNotThrow(() => assertRegistryInstallationId('inst_0123456789abcdef'))
    assert.doesNotThrow(() => assertRegistryWorkerId('worker_0123456789abcdef'))
  })

  it('rejects path-like, control-character, empty, and oversized identities', () => {
    for (const registryId of [
      '',
      '../agent',
      'agent/name',
      'agent\u0000name',
      `a${'b'.repeat(128)}`,
    ]) {
      assert.throws(() => assertRegistryCandidateInput({ ...valid, registryId }), /registryId/i)
    }
    for (const version of ['', '../1.0.0', '1.0.0\nprivate', 'v'.repeat(129)]) {
      assert.throws(() => assertRegistryCandidateInput({ ...valid, version }), /version/i)
    }
    assert.throws(() => assertRegistryWorkerId('../worker'), /workerId/i)
    assert.throws(() => assertRegistryInstallationId('installation'.repeat(20)), /installationId/i)
  })

  it('rejects unknown distributions, non-canonical digests, and invalid trust facts', () => {
    assert.throws(
      () => assertRegistryCandidateInput({ ...valid, distribution: 'shell' as never }),
      /distribution/i,
    )
    for (const manifestDigest of [
      'a'.repeat(64),
      `sha256:${'A'.repeat(64)}`,
      'sha256:abc',
      `sha512:${'a'.repeat(64)}`,
    ]) {
      assert.throws(
        () => assertRegistryCandidateInput({ ...valid, manifestDigest }),
        /manifestDigest/i,
      )
    }
    assert.throws(
      () =>
        assertRegistryCandidateInput({
          ...valid,
          trust: { explicitNoSha: true, acceptedAt: 'now' },
        }),
      /acceptedAt/i,
    )
    assert.throws(
      () =>
        assertRegistryCandidateInput({
          ...valid,
          trust: { explicitNoSha: 'yes' as never },
        }),
      /explicitNoSha/i,
    )
  })

  it('bounds registration names, role lists, booleans, and installation ids', () => {
    assert.doesNotThrow(() =>
      assertRegistryRegistrationInput({
        ...valid,
        installationId: 'inst_0123456789abcdef',
        name: 'My Agent',
        primaryRole: 'general',
        roles: ['general', 'coder'],
        enabled: true,
      }),
    )
    assert.throws(
      () =>
        assertRegistryRegistrationInput({
          ...valid,
          installationId: 'inst_0123456789abcdef',
          name: 'x'.repeat(129),
        }),
      /name/i,
    )
    assert.throws(
      () =>
        assertRegistryRegistrationInput({
          ...valid,
          installationId: 'inst_0123456789abcdef',
          primaryRole: 'root',
        }),
      /primaryRole/i,
    )
    assert.throws(
      () =>
        assertRegistryRegistrationInput({
          ...valid,
          installationId: 'inst_0123456789abcdef',
          roles: Array.from({ length: 7 }, () => 'general'),
        }),
      /roles/i,
    )
    assert.throws(
      () =>
        assertRegistryRegistrationInput({
          ...valid,
          installationId: 'inst_0123456789abcdef',
          enabled: 'yes',
        }),
      /enabled/i,
    )
  })

  it('bounds env-var secret names and values without inspecting their contents', () => {
    assert.doesNotThrow(() =>
      assertRegistrySecretInput({
        envName: 'FIXTURE_TOKEN_1',
        value: 'secret\nwith spaces',
      }),
    )
    for (const envName of ['', '1TOKEN', 'TOKEN-NAME', 'A'.repeat(129)]) {
      assert.throws(() => assertRegistrySecretInput({ envName, value: 'secret' }), /envName/i)
    }
    assert.throws(() => assertRegistrySecretInput({ envName: 'TOKEN', value: `x\0y` }), /value/i)
    assert.throws(
      () => assertRegistrySecretInput({ envName: 'TOKEN', value: 'x'.repeat(64 * 1024 + 1) }),
      /value/i,
    )
  })
})
