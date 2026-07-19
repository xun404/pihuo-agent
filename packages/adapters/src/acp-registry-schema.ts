/**
 * Schema major checks + canonical digest helpers for ACP Registry.
 */
import { createHash } from 'node:crypto'
import {
  BUNDLED_REGISTRY_SCHEMA_VERSION,
  isSupportedRegistrySchemaVersion,
  parseSchemaMajor,
  SUPPORTED_REGISTRY_SCHEMA_MAJOR,
} from './bundled/acp-registry-compatibility.js'

export {
  BUNDLED_REGISTRY_SCHEMA_VERSION,
  isSupportedRegistrySchemaVersion,
  parseSchemaMajor,
  SUPPORTED_REGISTRY_SCHEMA_MAJOR,
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Stable JSON: recursively sort object keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): Json {
  if (value === null || typeof value !== 'object') return value as Json
  if (Array.isArray(value)) return value.map(sortValue)
  const rec = value as Record<string, unknown>
  const out: Record<string, Json> = {}
  for (const key of Object.keys(rec).sort()) {
    out[key] = sortValue(rec[key])
  }
  return out
}

export function sha256HexOfCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function digestOfAgentEntry(agent: unknown): string {
  return `sha256:${sha256HexOfCanonical(agent)}`
}

export function digestOfRegistryPayload(payload: unknown): string {
  return `sha256:${sha256HexOfCanonical(payload)}`
}

export class AcpRegistrySchemaError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AcpRegistrySchemaError'
    this.code = code
  }
}

/** Reject unsupported schema major at the catalog boundary. */
export function assertSupportedRegistrySchemaVersion(version: string): void {
  if (!isSupportedRegistrySchemaVersion(version)) {
    throw new AcpRegistrySchemaError(
      'ACP_REGISTRY_SCHEMA_UNSUPPORTED',
      `Unsupported ACP registry schema version ${version}; this app supports major ${SUPPORTED_REGISTRY_SCHEMA_MAJOR}`,
    )
  }
}
