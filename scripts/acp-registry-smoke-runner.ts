#!/usr/bin/env node
import {
  apiGetRegistryCatalog,
  apiPrepareRegistry,
  apiProbeWorker,
  apiRegisterRegistry,
  registryApiPublicError,
} from '../packages/mastra-app/src/acp-registry-api.js'
import { runRegistrySmoke, type SmokeSelection } from './acp-registry-smoke-runner-lib.js'

const MAX_REQUEST_BYTES = 8 * 1024
const MAX_AGENTS = 5
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/iu
const DISTRIBUTIONS = new Set(['npx', 'uvx', 'binary'])

function readRequest(): {
  confirmed: true
  selections: SmokeSelection[]
  allowUnverifiedBinary: boolean
} {
  if (!process.send) throw new Error('runner requires the isolated smoke controller')
  const index = process.argv.indexOf('--request-base64')
  const encoded = index >= 0 ? process.argv[index + 1] : undefined
  if (!encoded || encoded.length > MAX_REQUEST_BYTES * 2) throw new Error('invalid request')
  const bytes = Buffer.from(encoded, 'base64url')
  if (bytes.length > MAX_REQUEST_BYTES) throw new Error('invalid request')
  const request = JSON.parse(bytes.toString('utf8')) as {
    confirmed?: unknown
    selections?: unknown
    allowUnverifiedBinary?: unknown
  }
  if (request.confirmed !== true || !Array.isArray(request.selections)) {
    throw new Error('runner confirmation missing')
  }
  if (request.selections.length < 1 || request.selections.length > MAX_AGENTS) {
    throw new Error('invalid selection count')
  }
  const seen = new Set<string>()
  const selections = request.selections.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('invalid selection')
    const value = raw as { registryId?: unknown; distribution?: unknown }
    if (typeof value.registryId !== 'string' || !AGENT_ID.test(value.registryId)) {
      throw new Error('invalid selection')
    }
    if (
      value.distribution !== undefined &&
      (typeof value.distribution !== 'string' || !DISTRIBUTIONS.has(value.distribution))
    ) {
      throw new Error('invalid selection')
    }
    if (seen.has(value.registryId)) throw new Error('duplicate selection')
    seen.add(value.registryId)
    return {
      registryId: value.registryId,
      ...(value.distribution
        ? { distribution: value.distribution as SmokeSelection['distribution'] }
        : {}),
    }
  })
  return {
    confirmed: true,
    selections,
    allowUnverifiedBinary: request.allowUnverifiedBinary === true,
  }
}

const operationController = new AbortController()
const requestStop = () => {
  if (!operationController.signal.aborted) operationController.abort()
}
process.on('message', (message) => {
  if (
    message &&
    typeof message === 'object' &&
    (message as { type?: unknown }).type === 'shutdown'
  ) {
    requestStop()
  }
})
process.on('SIGINT', requestStop)
process.on('SIGTERM', requestStop)

async function main(): Promise<void> {
  const request = readRequest()
  const results = await runRegistrySmoke({
    selections: request.selections,
    allowUnverifiedBinary: request.allowUnverifiedBinary,
    shouldStop: () => operationController.signal.aborted,
    signal: operationController.signal,
    services: {
      getCatalog: () => apiGetRegistryCatalog({ refresh: false }),
      prepare: (body, options) => apiPrepareRegistry(body, options),
      register: apiRegisterRegistry,
      probe: (workerId, options) => apiProbeWorker(workerId, options),
      publicError: registryApiPublicError,
    },
  })
  const ok = results.every((entry) => entry.status === 'pass' || entry.status === 'auth_required')
  process.stdout.write(`${JSON.stringify({ ok, results })}\n`)
  process.exitCode = ok ? 0 : 1
}

main()
  .catch(() => {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        results: [{ status: 'upstream_failed', code: 'SMOKE_RUNNER_FAILED' }],
      })}\n`,
    )
    process.exitCode = 1
  })
  .finally(() => {
    try {
      process.disconnect?.()
    } catch {}
  })
