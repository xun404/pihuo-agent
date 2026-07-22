import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { api, clearDesktopToken, encodePathSegment } from './api.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  clearDesktopToken()
})

test('worker model list binds the request to an explicit project id', async () => {
  let requestedUrl = ''
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return Response.json({ ok: true, models: [] })
  }

  await api.fetchWorkerModels('worker-a', {
    q: 'sonnet',
    limit: 40,
    projectId: 'project-a',
  })

  const url = new URL(requestedUrl)
  assert.equal(url.pathname, '/api/workers/worker-a/models')
  assert.equal(url.searchParams.get('projectId'), 'project-a')
  assert.equal(url.searchParams.get('q'), 'sonnet')
})

test('worker registry catalog GET is local-only and manual update uses an explicit POST', async () => {
  let requestedUrl = ''
  let requestedMethod = ''
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input)
    requestedMethod = String(init?.method ?? 'GET')
    return Response.json({ version: '1.0.0', agents: [], updateStatus: 'up_to_date' })
  }

  const result = await api.getWorkerRegistry()

  let url = new URL(requestedUrl)
  assert.equal(url.pathname, '/api/workers/registry')
  assert.equal(url.searchParams.has('refresh'), false)
  assert.equal(requestedMethod, 'GET')
  assert.deepEqual(result, { version: '1.0.0', agents: [], updateStatus: 'up_to_date' })

  await api.checkWorkerRegistryUpdate()
  url = new URL(requestedUrl)
  assert.equal(url.pathname, '/api/workers/registry/check-update')
  assert.equal(requestedMethod, 'POST')
})

test('custom ACP registration uses the probe-before-persist Owner route', async () => {
  let requestedUrl = ''
  let requestBody: unknown
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input)
    requestBody = JSON.parse(String(init?.body))
    return Response.json({ worker: {} })
  }

  await api.registerCustomAcpWorker({
    name: 'Custom Agent',
    launchKind: 'npx',
    packageSpec: '@scope/agent@1',
  })

  assert.equal(new URL(requestedUrl).pathname, '/api/workers/custom/register')
  assert.deepEqual(requestBody, {
    name: 'Custom Agent',
    launchKind: 'npx',
    packageSpec: '@scope/agent@1',
  })
})

test('registry prepare returns an operation and supports bounded polling/cancellation', async () => {
  const requests: Array<{ pathname: string; method: string }> = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = String(init?.method ?? 'GET')
    requests.push({ pathname: url.pathname, method })
    return Response.json(
      url.pathname.endsWith('/prepare')
        ? {
            operationId: 'op_1',
            kind: 'prepare',
            status: 'queued',
            createdAt: '2026-07-17T00:00:00.000Z',
            updatedAt: '2026-07-17T00:00:00.000Z',
            events: [],
          }
        : {
            operationId: 'op_1',
            kind: 'prepare',
            status: method === 'DELETE' ? 'cancelled' : 'running',
            createdAt: '2026-07-17T00:00:00.000Z',
            updatedAt: '2026-07-17T00:00:01.000Z',
            events: [],
          },
    )
  }

  const created = await api.prepareRegistryAgent({
    registryId: 'a',
    version: '1.0.0',
    distribution: 'npx',
    manifestDigest: `sha256:${'a'.repeat(64)}`,
  })
  const running = await api.getRegistryOperation(created.operationId)
  const cancelled = await api.cancelRegistryOperation(created.operationId)

  assert.equal(created.status, 'queued')
  assert.equal(running.status, 'running')
  assert.equal(cancelled.status, 'cancelled')
  assert.deepEqual(requests, [
    { pathname: '/api/workers/registry/prepare', method: 'POST' },
    { pathname: '/api/workers/registry/operations/op_1', method: 'GET' },
    { pathname: '/api/workers/registry/operations/op_1', method: 'DELETE' },
  ])
})

test('terminal auth keeps the one-time token in WebSocket subprotocols, never the URL', async () => {
  const token = 'p'.repeat(32)
  const url = api.terminalAuthWebSocketUrl('worker/a', 'attempt?1')
  const protocols = api.terminalAuthWebSocketProtocols(token)

  assert.match(
    url,
    /^ws:\/\/127\.0\.0\.1:4111\/api\/workers\/worker%2Fa\/auth-terminal\/attempt%3F1\/ws$/u,
  )
  assert.doesNotMatch(url, new RegExp(token, 'u'))
  assert.deepEqual(protocols, ['ra-auth-v1', `ra-auth-token.${token}`])
})

test('agent authentication starts a cancellable Owner operation', async () => {
  let requestedUrl = ''
  let requestBody: unknown
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input)
    requestBody = JSON.parse(String(init?.body))
    return Response.json({
      operationId: 'op_auth',
      kind: 'authenticate',
      status: 'queued',
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
      events: [],
    })
  }

  const operation = await api.authenticateRegistryWorker('worker/a', 'oauth')

  assert.equal(operation.kind, 'authenticate')
  assert.equal(new URL(requestedUrl).pathname, '/api/workers/worker%2Fa/authenticate')
  assert.deepEqual(requestBody, { methodId: 'oauth' })
})

test('worker model pin carries the project used for availability validation', async () => {
  let requestBody: unknown
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return Response.json({ worker: {} })
  }

  await api.setWorkerModel('worker-a', 'provider/model-a', 'project-a')
  assert.deepEqual(requestBody, {
    model: 'provider/model-a',
    projectId: 'project-a',
  })
})

test('opaque ids are encoded as one URL path segment', async () => {
  const workerId = 'custom/worker?owner=other#fragment'
  let requestedUrl = ''
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return Response.json({ worker: {} })
  }

  await api.toggleWorker(workerId, true)

  const url = new URL(requestedUrl)
  assert.equal(url.pathname, `/api/workers/${encodePathSegment(workerId)}/toggle`)
  assert.equal(url.search, '')
  assert.equal(url.hash, '')
})

test('snapshot refresh forwards cancellation to the underlying fetch', async () => {
  globalThis.fetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      assert.ok(signal)
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    })

  const controller = new AbortController()
  const pending = api.snapshot(controller.signal)
  controller.abort()

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  )
})
