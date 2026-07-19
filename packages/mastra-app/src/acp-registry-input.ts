import {
  WORKER_ROLES,
  type AcpRegistryDistributionKind,
  type WorkerRole,
} from '@router-agents/shared'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u
const MAX_SECRET_VALUE_BYTES = 64 * 1024
const DISTRIBUTIONS = new Set<AcpRegistryDistributionKind>(['npx', 'uvx', 'binary'])

export class RegistryInputValidationError extends Error {
  readonly code = 'ACP_REGISTRY_ENTRY_INVALID'
  readonly httpStatus = 400

  constructor(readonly field: string) {
    super(`Invalid Registry ${field}`)
    this.name = 'RegistryInputValidationError'
  }
}

function assertSafeId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new RegistryInputValidationError(field)
  }
}

export function assertRegistryWorkerId(value: unknown): asserts value is string {
  assertSafeId(value, 'workerId')
}

export function assertRegistryInstallationId(value: unknown): asserts value is string {
  assertSafeId(value, 'installationId')
}

export function assertRegistryOperationId(value: unknown): asserts value is string {
  assertSafeId(value, 'operationId')
}

export function assertRegistryAuthMethodId(value: unknown): asserts value is string {
  assertSafeId(value, 'methodId')
}

export function assertRegistrySecretInput(input: {
  envName: unknown
  value: unknown
}): asserts input is { envName: string; value: string } {
  if (typeof input.envName !== 'string' || !ENV_NAME.test(input.envName)) {
    throw new RegistryInputValidationError('envName')
  }
  if (
    typeof input.value !== 'string' ||
    input.value.includes('\0') ||
    Buffer.byteLength(input.value, 'utf8') > MAX_SECRET_VALUE_BYTES
  ) {
    throw new RegistryInputValidationError('value')
  }
}

export function assertRegistryCandidateInput(input: {
  registryId: unknown
  version?: unknown
  distribution: unknown
  manifestDigest: unknown
  trust?: unknown
}): void {
  assertSafeId(input.registryId, 'registryId')
  if (
    input.version !== undefined &&
    (typeof input.version !== 'string' || !SAFE_VERSION.test(input.version))
  ) {
    throw new RegistryInputValidationError('version')
  }
  if (
    typeof input.distribution !== 'string' ||
    !DISTRIBUTIONS.has(input.distribution as AcpRegistryDistributionKind)
  ) {
    throw new RegistryInputValidationError('distribution')
  }
  if (typeof input.manifestDigest !== 'string' || !SHA256_DIGEST.test(input.manifestDigest)) {
    throw new RegistryInputValidationError('manifestDigest')
  }

  if (input.trust === undefined) return
  if (!input.trust || typeof input.trust !== 'object' || Array.isArray(input.trust)) {
    throw new RegistryInputValidationError('trust')
  }
  const trust = input.trust as Record<string, unknown>
  const keys = Object.keys(trust)
  if (keys.some((key) => key !== 'explicitNoSha' && key !== 'acceptedAt')) {
    throw new RegistryInputValidationError('trust')
  }
  if (trust.explicitNoSha !== undefined && typeof trust.explicitNoSha !== 'boolean') {
    throw new RegistryInputValidationError('explicitNoSha')
  }
  if (trust.acceptedAt !== undefined) {
    if (
      typeof trust.acceptedAt !== 'string' ||
      trust.acceptedAt.length > 32 ||
      !Number.isFinite(Date.parse(trust.acceptedAt)) ||
      new Date(trust.acceptedAt).toISOString() !== trust.acceptedAt
    ) {
      throw new RegistryInputValidationError('acceptedAt')
    }
  }
}

export function assertRegistryRegistrationInput(input: {
  registryId: unknown
  version: unknown
  distribution: unknown
  manifestDigest: unknown
  installationId: unknown
  name?: unknown
  primaryRole?: unknown
  roles?: unknown
  enabled?: unknown
}): void {
  assertRegistryCandidateInput(input)
  if (typeof input.version !== 'string' || !SAFE_VERSION.test(input.version)) {
    throw new RegistryInputValidationError('version')
  }
  assertRegistryInstallationId(input.installationId)

  if (input.name !== undefined) {
    if (
      typeof input.name !== 'string' ||
      input.name.trim().length < 1 ||
      input.name.trim().length > 128 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(input.name)
    ) {
      throw new RegistryInputValidationError('name')
    }
  }
  if (
    input.primaryRole !== undefined &&
    (typeof input.primaryRole !== 'string' ||
      !WORKER_ROLES.includes(input.primaryRole as WorkerRole))
  ) {
    throw new RegistryInputValidationError('primaryRole')
  }
  if (input.roles !== undefined) {
    if (
      !Array.isArray(input.roles) ||
      input.roles.length < 1 ||
      input.roles.length > WORKER_ROLES.length ||
      input.roles.some(
        (role) => typeof role !== 'string' || !WORKER_ROLES.includes(role as WorkerRole),
      ) ||
      new Set(input.roles).size !== input.roles.length
    ) {
      throw new RegistryInputValidationError('roles')
    }
  }
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new RegistryInputValidationError('enabled')
  }
}
