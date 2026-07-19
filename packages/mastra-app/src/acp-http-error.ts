import { isAcpSessionRuntimeError } from '@router-agents/adapters'

export interface AcpHttpFailure {
  status: 503
  body: {
    error: string
    code: string
    canResetAcpContext: boolean
  }
}

/** Convert only typed, already-redacted ACP errors into a public HTTP response. */
export function asAcpHttpFailure(error: unknown): AcpHttpFailure | undefined {
  if (!isAcpSessionRuntimeError(error)) return undefined
  return {
    status: 503,
    body: {
      error: error.publicMessage,
      code: error.code,
      canResetAcpContext: error.canResetAcpContext,
    },
  }
}
