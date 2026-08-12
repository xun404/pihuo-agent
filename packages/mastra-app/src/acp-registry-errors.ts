import { AcpInstallError } from '@swarmdesk-agent/adapters'
import { RegistryRegistrationError } from './acp-worker-registration.js'
import {
  projectRegistryPublicError,
  unknownRegistryCatalogPublicError,
} from './acp-registry-public-error.js'

/** Publicly safe Registry API error with a stable code and HTTP projection. */
export class RegistryApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
  ) {
    super(message)
    this.name = 'RegistryApiError'
  }
}

/** Project only known Registry failures across HTTP API boundaries. */
export function registryApiPublicError(e: unknown): {
  error: string
  code: string
  status: number
} {
  if (e instanceof RegistryApiError) {
    return projectRegistryPublicError({ message: e.message, code: e.code, status: e.httpStatus })
  }
  if (e instanceof RegistryRegistrationError) {
    return projectRegistryPublicError({ message: e.message, code: e.code, status: e.httpStatus })
  }
  if (e instanceof AcpInstallError) {
    return projectRegistryPublicError({
      message: e.message,
      code: e.code,
      status: e.code === 'ACP_INSTALL_DIGEST_MISMATCH' ? 409 : 400,
    })
  }
  return {
    error: 'Registry operation failed',
    code: 'ACP_INSTALL_FAILED',
    status: 500,
  }
}

export { unknownRegistryCatalogPublicError as registryCatalogApiPublicError }
