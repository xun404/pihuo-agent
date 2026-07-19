/**
 * Static ACP Registry release artifacts.
 *
 * Keeping these as module imports lets esbuild include the snapshot and both
 * pinned schemas in the packaged runtime. Runtime code must not reach back to
 * `packages/.../src` on disk or fetch a newer schema.
 */
import agentSchema from './bundled/acp-agent.schema.json'
import registry from './bundled/acp-registry.json'
import registrySchema from './bundled/acp-registry.schema.json'
import { BUNDLED_ACP_REGISTRY_META } from './bundled/acp-registry-meta.js'
import {
  BUNDLED_REGISTRY_SCHEMA_VERSION,
  isSupportedRegistrySchemaVersion,
  parseSchemaMajor,
} from './bundled/acp-registry-compatibility.js'
import { digestOfRegistryPayload } from './acp-registry-schema.js'

export const BUNDLED_ACP_REGISTRY_ARTIFACTS = Object.freeze({
  registry,
  registrySchema,
  agentSchema,
})

export interface BundledAcpRegistryVerification {
  schemaVersion: string
  schemaMajor: number
  digest: string
  agentCount: number
}

export function verifyBundledAcpRegistryArtifacts(
  expected: {
    schemaVersion?: string
    digest?: string
    agentCount?: number
  } = BUNDLED_ACP_REGISTRY_META,
): BundledAcpRegistryVerification {
  const schemaVersion = registry.version
  const schemaMajor = parseSchemaMajor(schemaVersion)
  if (
    schemaMajor === null ||
    !isSupportedRegistrySchemaVersion(schemaVersion) ||
    schemaVersion !== BUNDLED_REGISTRY_SCHEMA_VERSION ||
    (expected.schemaVersion !== undefined && schemaVersion !== expected.schemaVersion)
  ) {
    throw new Error('Bundled ACP Registry schema version does not match this runtime')
  }

  const digest = digestOfRegistryPayload(registry)
  if (expected.digest !== undefined && digest !== expected.digest) {
    throw new Error('Bundled ACP Registry digest does not match release metadata')
  }

  const agentCount = registry.agents.length
  if (expected.agentCount !== undefined && agentCount !== expected.agentCount) {
    throw new Error('Bundled ACP Registry agent count does not match release metadata')
  }

  if (
    registrySchema.$schema !== 'http://json-schema.org/draft-07/schema#' ||
    agentSchema.$schema !== 'http://json-schema.org/draft-07/schema#'
  ) {
    throw new Error('Bundled ACP Registry schemas are missing or unsupported')
  }

  return { schemaVersion, schemaMajor, digest, agentCount }
}
