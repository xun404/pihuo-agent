import { ACP_PUBLIC_ERROR_CODES } from '@pihuo-agent/shared'

const PUBLIC_ERROR_CODES = new Set<string>(ACP_PUBLIC_ERROR_CODES)
const PUBLIC_ERROR_TEXT: Readonly<Record<string, string>> = Object.freeze({
  ACP_REGISTRY_UNAVAILABLE: 'Registry catalog is unavailable',
  ACP_REGISTRY_SCHEMA_UNSUPPORTED: 'Registry catalog requires an application update',
  ACP_REGISTRY_ENTRY_INVALID: 'Registry entry is invalid',
  ACP_PLATFORM_UNSUPPORTED: 'Registry agent is unavailable on this platform',
  ACP_RUNNER_MISSING: 'Required Registry runner is unavailable',
  ACP_INSTALL_TRUST_REQUIRED: 'Explicit trust is required before installation',
  ACP_INSTALL_DIGEST_MISMATCH: 'Registry installation integrity check failed',
  ACP_INSTALL_ARCHIVE_UNSAFE: 'Registry installation archive is unsafe',
  ACP_INSTALL_DOWNLOAD_FAILED: 'Registry installation download failed',
  ACP_INSTALL_FAILED: 'Registry installation failed',
  ACP_PROTOCOL_INCOMPATIBLE: 'Registry agent protocol is incompatible',
  WORKER_AUTH_REQUIRED: 'Worker authentication is required',
  WORKER_AUTH_FAILED: 'Worker authentication failed',
  WORKER_NOT_READY: 'Worker is not ready',
  WORKER_HAS_OPEN_JOBS: 'Worker has in-progress jobs',
  WORKER_REFERENCED_BY_ROLE: 'Worker is in use by team members',
  WORKER_DUPLICATE_REGISTRY: 'This registry agent is already registered',
  WORKER_DUPLICATE_NAME: 'A worker with this name already exists',
})

export type RegistryPublicError = {
  error: string
  code: string
  status: number
}

/**
 * The only projection allowed at Registry service/API/HTTP boundaries.
 * Only stable code-mapped text crosses the public boundary. The cause message
 * is intentionally never reflected, regardless of its shape.
 */
export function projectRegistryPublicError(input: {
  code: string
  message: string
  status: number
}): RegistryPublicError {
  if (!PUBLIC_ERROR_CODES.has(input.code)) {
    return {
      error: 'Registry operation failed',
      code: 'ACP_INSTALL_FAILED',
      status: 500,
    }
  }
  return {
    error: PUBLIC_ERROR_TEXT[input.code] ?? 'Registry operation failed',
    code: input.code,
    status: input.status,
  }
}

export function unknownRegistryCatalogPublicError(error: unknown): RegistryPublicError {
  return projectRegistryPublicError({
    code: 'ACP_REGISTRY_UNAVAILABLE',
    message: error instanceof Error ? error.message : String(error),
    status: 502,
  })
}
