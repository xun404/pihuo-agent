/**
 * Versioned compatibility patches for official ACP Registry schema.
 *
 * Official registry.schema.json uses additionalProperties:false and does not
 * declare top-level `extensions`, but live registry.json includes
 * `extensions: []`. This patch documents that single deviation only.
 *
 * Schema is pinned to the application release; runtime never downloads schema.
 */

export const SUPPORTED_REGISTRY_SCHEMA_MAJOR = 1

/** Schema version string embedded with this app release. */
export const BUNDLED_REGISTRY_SCHEMA_VERSION = '1.0.0'

/**
 * Extra top-level properties allowed beyond official registry.schema.json.
 * Keep this list minimal and explicit.
 */
export const REGISTRY_TOP_LEVEL_COMPAT_PROPERTIES = {
  extensions: {
    type: 'array',
    description:
      'Upstream registry.json may include extensions:[] though schema omits it (2026-07).',
    items: {},
  },
} as const

/** Official CDN paths used by maintenance sync (not fetched at app startup). */
export const ACP_REGISTRY_CDN = {
  registryJson: 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json',
  registrySchema: 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.schema.json',
  agentSchema: 'https://cdn.agentclientprotocol.com/registry/v1/latest/agent.schema.json',
} as const

export function parseSchemaMajor(version: string): number | null {
  const m = /^(\d+)\./.exec(version.trim())
  if (!m) return null
  return Number(m[1])
}

export function isSupportedRegistrySchemaVersion(version: string): boolean {
  const major = parseSchemaMajor(version)
  return major === SUPPORTED_REGISTRY_SCHEMA_MAJOR
}
