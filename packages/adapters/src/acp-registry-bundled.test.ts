import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUNDLED_ACP_REGISTRY_ARTIFACTS,
  verifyBundledAcpRegistryArtifacts,
} from './acp-registry-bundled.js'

describe('bundled ACP Registry artifacts', () => {
  it('statically loads the schema and snapshot and verifies release metadata', () => {
    const result = verifyBundledAcpRegistryArtifacts()

    assert.equal(result.schemaVersion, '1.0.0')
    assert.equal(result.schemaMajor, 1)
    assert.equal(result.agentCount, 38)
    assert.match(result.digest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(BUNDLED_ACP_REGISTRY_ARTIFACTS.registry.agents.length, result.agentCount)
    assert.equal(
      BUNDLED_ACP_REGISTRY_ARTIFACTS.registrySchema.$schema,
      'http://json-schema.org/draft-07/schema#',
    )
    assert.equal(
      BUNDLED_ACP_REGISTRY_ARTIFACTS.agentSchema.$schema,
      'http://json-schema.org/draft-07/schema#',
    )
  })

  it('fails closed when any release metadata no longer matches the static payload', () => {
    assert.throws(
      () => verifyBundledAcpRegistryArtifacts({ digest: `sha256:${'0'.repeat(64)}` }),
      /digest/i,
    )
    assert.throws(() => verifyBundledAcpRegistryArtifacts({ schemaVersion: '2.0.0' }), /schema/i)
    assert.throws(() => verifyBundledAcpRegistryArtifacts({ agentCount: 0 }), /agent count/i)
  })
})
