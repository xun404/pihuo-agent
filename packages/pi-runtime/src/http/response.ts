import type { ServerResponse } from 'node:http'

type AcpFailure = {
  status: number
  body: unknown
}

type ResponseHelpersDependencies = {
  corsFor: () => Record<string, string>
  asAcpHttpFailure: (error: unknown) => AcpFailure | undefined
}

/** Shared Owner HTTP response/error projection helpers. */
export function createResponseHelpers({ corsFor, asAcpHttpFailure }: ResponseHelpersDependencies) {
  function send(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json',
      ...corsFor(),
    })
    res.end(json)
  }

  function sendAuthFailed(res: ServerResponse): void {
    send(res, 401, { error: 'RUNTIME_AUTH_FAILED', code: 'RUNTIME_AUTH_FAILED' })
  }

  function sendUnexpectedFailure(res: ServerResponse, error: unknown, context: string): void {
    console.error(`[http] ${context} failed`, error)
    send(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' })
  }

  function sendAcpOrUnexpectedFailure(res: ServerResponse, error: unknown, context: string): void {
    const failure = asAcpHttpFailure(error)
    if (failure) {
      send(res, failure.status, failure.body)
      return
    }
    sendUnexpectedFailure(res, error, context)
  }

  return {
    send,
    sendAuthFailed,
    sendUnexpectedFailure,
    sendAcpOrUnexpectedFailure,
  }
}
