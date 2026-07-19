import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  agent,
  ndJsonStream,
  methods,
  PROTOCOL_VERSION,
  RequestError,
  type AgentApp,
  type Stream,
  type AgentCapabilities,
  type AuthMethod,
} from '@agentclientprotocol/sdk'
import {
  probeConnectedAgent,
  readinessForSpawnFailure,
  readinessPrepared,
} from './acp-capability-probe.js'
import { AcpSessionDriver } from './acp-session-driver.js'

function createPairedStreams(): { clientStream: Stream; agentStream: Stream } {
  const c2a = new TransformStream<Uint8Array, Uint8Array>()
  const a2c = new TransformStream<Uint8Array, Uint8Array>()
  return {
    clientStream: ndJsonStream(c2a.writable, a2c.readable),
    agentStream: ndJsonStream(a2c.writable, c2a.readable),
  }
}

function createFakeAgent(opts: {
  protocolVersion?: number
  capabilities?: Partial<AgentCapabilities>
  authMethods?: AuthMethod[]
  requireAuth?: boolean
  authenticated?: { value: boolean }
  onAuthenticate?: (methodId: string) => void
  onClose?: () => void
  onDelete?: () => void
  sessionError?: Error
  sessionErrorAfterAuth?: Error
  authenticateError?: Error
}): AgentApp {
  const authState = opts.authenticated ?? { value: !opts.requireAuth }
  return agent({ name: 'probe-agent' })
    .onRequest(methods.agent.initialize, async (ctx) => {
      // Capture client caps for assertion via response meta
      const caps = ctx.params.clientCapabilities as { auth?: { terminal?: boolean } } | undefined
      return {
        protocolVersion: opts.protocolVersion ?? PROTOCOL_VERSION,
        agentCapabilities: opts.capabilities ?? {},
        authMethods: opts.authMethods ?? [],
        agentInfo: { name: 'probe-agent', version: '9.9.9' },
        _meta: { clientAuthTerminal: caps?.auth?.terminal === true },
      }
    })
    .onRequest(methods.agent.authenticate, async (ctx) => {
      opts.onAuthenticate?.(ctx.params.methodId)
      if (opts.authenticateError) throw opts.authenticateError
      authState.value = true
      return {}
    })
    .onRequest(methods.agent.session.new, async () => {
      if (opts.sessionError) throw opts.sessionError
      if (!authState.value) {
        throw RequestError.authRequired({ reason: 'auth_required' })
      }
      if (opts.sessionErrorAfterAuth) throw opts.sessionErrorAfterAuth
      return { sessionId: 'sid-ready', configOptions: [] }
    })
    .onRequest(methods.agent.session.close, async () => {
      opts.onClose?.()
      return {}
    })
    .onRequest(methods.agent.session.delete, async () => {
      opts.onDelete?.()
      return {}
    })
}

describe('probeConnectedAgent', () => {
  it('returns ready when initialize + session/new succeed', async () => {
    const { clientStream, agentStream } = createPairedStreams()
    const app = createFakeAgent({})
    app.connect(agentStream)
    const result = await probeConnectedAgent('/tmp/probe-cwd', clientStream)
    assert.equal(result.readiness.status, 'ready')
    assert.equal(result.readiness.code, 'SESSION_READY')
    assert.equal(result.capabilitySummary.protocolVersion, PROTOCOL_VERSION)
    assert.equal(result.capabilitySummary.agentName, 'probe-agent')
  })

  it('does not advertise terminal auth by default', async () => {
    const { clientStream, agentStream } = createPairedStreams()
    let sawTerminal: boolean | undefined
    const app = agent({ name: 't' })
      .onRequest(methods.agent.initialize, async (ctx) => {
        sawTerminal = Boolean(
          (ctx.params.clientCapabilities as { auth?: { terminal?: boolean } })?.auth?.terminal,
        )
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {},
          authMethods: [],
        }
      })
      .onRequest(methods.agent.session.new, async () => ({
        sessionId: 's1',
        configOptions: [],
      }))
    app.connect(agentStream)
    await probeConnectedAgent('/tmp/p', clientStream)
    assert.equal(sawTerminal, false)
  })

  it('marks auth_required without matching error message regex', async () => {
    const { clientStream, agentStream } = createPairedStreams()
    const app = createFakeAgent({
      requireAuth: true,
      authMethods: [{ id: 'oauth', name: 'OAuth' }],
    })
    app.connect(agentStream)
    const result = await probeConnectedAgent('/tmp/p', clientStream)
    assert.equal(result.readiness.status, 'auth_required')
    assert.equal(result.readiness.code, 'WORKER_AUTH_REQUIRED')
    assert.equal(result.readiness.nextAction, 'authenticate')
    assert.equal(result.authMethods[0]?.type, 'agent')
  })

  it('authenticate then session/new reaches ready', async () => {
    const { clientStream, agentStream } = createPairedStreams()
    const app = createFakeAgent({
      requireAuth: true,
      authMethods: [{ id: 'oauth', name: 'OAuth' }],
    })
    app.connect(agentStream)
    const result = await probeConnectedAgent('/tmp/p', clientStream, {
      authenticateMethodId: 'oauth',
    })
    assert.equal(result.readiness.status, 'ready')
  })

  it('distinguishes authenticate RPC failure from retry session/new failure', async () => {
    const authFailure = createPairedStreams()
    createFakeAgent({
      requireAuth: true,
      authMethods: [{ id: 'oauth', name: 'OAuth' }],
      authenticateError: RequestError.internalError({ secret: 'auth-secret' }),
    }).connect(authFailure.agentStream)
    const failedAuth = await probeConnectedAgent('/tmp/p', authFailure.clientStream, {
      authenticateMethodId: 'oauth',
    })
    assert.equal(failedAuth.readiness.code, 'WORKER_AUTH_FAILED')
    assert.equal(failedAuth.readiness.message, 'Agent authentication failed')
    assert.equal(JSON.stringify(failedAuth).includes('auth-secret'), false)

    const sessionFailure = createPairedStreams()
    createFakeAgent({
      requireAuth: true,
      authMethods: [{ id: 'oauth', name: 'OAuth' }],
      sessionErrorAfterAuth: RequestError.internalError({ secret: 'session-secret' }),
    }).connect(sessionFailure.agentStream)
    const failedSession = await probeConnectedAgent('/tmp/p', sessionFailure.clientStream, {
      authenticateMethodId: 'oauth',
    })
    assert.equal(failedSession.readiness.code, 'SESSION_FAILED')
    assert.equal(failedSession.readiness.message, 'ACP session setup failed')
    assert.equal(JSON.stringify(failedSession).includes('session-secret'), false)
  })

  it('rejects an unadvertised or non-agent method before authenticate', async () => {
    for (const authenticateMethodId of ['missing', 'terminal']) {
      let authenticateCalls = 0
      const { clientStream, agentStream } = createPairedStreams()
      const app = createFakeAgent({
        requireAuth: true,
        authMethods: [
          { id: 'oauth', name: 'OAuth' },
          { type: 'terminal', id: 'terminal', name: 'Terminal', args: ['login'] },
        ],
        onAuthenticate: () => {
          authenticateCalls += 1
        },
      })
      app.connect(agentStream)
      const result = await probeConnectedAgent('/tmp/p', clientStream, {
        authenticateMethodId,
      })
      assert.equal(result.readiness.status, 'failed')
      assert.equal(result.readiness.code, 'WORKER_AUTH_FAILED')
      assert.equal(authenticateCalls, 0)
    }
  })

  it('maps session/new failures to a stable sanitized result', async () => {
    const { clientStream, agentStream } = createPairedStreams()
    const app = createFakeAgent({
      sessionError: RequestError.internalError({
        stderr: 'raw-secret',
        path: '/private/agent/path',
      }),
    })
    app.connect(agentStream)
    const result = await probeConnectedAgent('/tmp/p', clientStream)
    assert.equal(result.readiness.code, 'SESSION_FAILED')
    assert.equal(result.readiness.message, 'ACP session setup failed')
    assert.equal(JSON.stringify(result).includes('raw-secret'), false)
    assert.equal(JSON.stringify(result).includes('/private/agent/path'), false)
  })

  it('best-effort cleans a successful setup session only when advertised', async () => {
    let closeCalls = 0
    let deleteCalls = 0
    const advertised = createPairedStreams()
    createFakeAgent({
      capabilities: { sessionCapabilities: { close: {} } },
      onClose: () => {
        closeCalls += 1
      },
      onDelete: () => {
        deleteCalls += 1
      },
    }).connect(advertised.agentStream)
    const ready = await probeConnectedAgent('/tmp/p', advertised.clientStream)
    assert.equal(ready.readiness.status, 'ready')
    assert.equal(closeCalls, 1)
    assert.equal(deleteCalls, 0)

    const omitted = createPairedStreams()
    createFakeAgent({
      onClose: () => {
        closeCalls += 1
      },
      onDelete: () => {
        deleteCalls += 1
      },
    }).connect(omitted.agentStream)
    await probeConnectedAgent('/tmp/p', omitted.clientStream)
    assert.equal(closeCalls, 1)
    assert.equal(deleteCalls, 0)
  })

  it('detects empty-object auth.logout capability', async () => {
    const { clientStream, agentStream } = createPairedStreams()
    createFakeAgent({ capabilities: { auth: { logout: {} } } }).connect(agentStream)
    const result = await probeConnectedAgent('/tmp/p', clientStream)
    assert.equal(result.capabilitySummary.authLogout, true)
  })

  it('marks incompatible when protocol version mismatches', async () => {
    const { clientStream, agentStream } = createPairedStreams()
    const app = createFakeAgent({ protocolVersion: PROTOCOL_VERSION + 99 })
    app.connect(agentStream)
    const result = await probeConnectedAgent('/tmp/p', clientStream)
    assert.equal(result.readiness.status, 'incompatible')
    assert.equal(result.readiness.code, 'ACP_PROTOCOL_INCOMPATIBLE')
  })

  it('disposes every non-ready driver even when keepDriver was requested', async () => {
    const originalDispose = AcpSessionDriver.prototype.dispose
    let disposeCalls = 0
    AcpSessionDriver.prototype.dispose = function patchedDispose() {
      disposeCalls += 1
      return originalDispose.call(this)
    }
    try {
      let before = disposeCalls
      const authRequired = createPairedStreams()
      createFakeAgent({
        requireAuth: true,
        authMethods: [{ id: 'oauth', name: 'OAuth' }],
      }).connect(authRequired.agentStream)
      const authResult = await probeConnectedAgent('/tmp/p', authRequired.clientStream, {
        keepDriver: true,
      })
      assert.equal(authResult.readiness.code, 'WORKER_AUTH_REQUIRED')
      assert.equal(authResult.driver, undefined)
      assert.ok(disposeCalls > before)

      before = disposeCalls
      const invalidMethod = createPairedStreams()
      createFakeAgent({
        requireAuth: true,
        authMethods: [{ id: 'oauth', name: 'OAuth' }],
      }).connect(invalidMethod.agentStream)
      const methodResult = await probeConnectedAgent('/tmp/p', invalidMethod.clientStream, {
        keepDriver: true,
        authenticateMethodId: 'missing',
      })
      assert.equal(methodResult.readiness.code, 'WORKER_AUTH_FAILED')
      assert.equal(methodResult.driver, undefined)
      assert.ok(disposeCalls > before)

      before = disposeCalls
      const sessionFailure = createPairedStreams()
      createFakeAgent({ sessionError: RequestError.internalError({}) }).connect(
        sessionFailure.agentStream,
      )
      const sessionResult = await probeConnectedAgent('/tmp/p', sessionFailure.clientStream, {
        keepDriver: true,
      })
      assert.equal(sessionResult.readiness.code, 'SESSION_FAILED')
      assert.equal(sessionResult.driver, undefined)
      assert.ok(disposeCalls > before)

      before = disposeCalls
      const initializeFailure = createPairedStreams()
      createFakeAgent({ protocolVersion: PROTOCOL_VERSION + 1 }).connect(
        initializeFailure.agentStream,
      )
      const initializeResult = await probeConnectedAgent('/tmp/p', initializeFailure.clientStream, {
        keepDriver: true,
      })
      assert.equal(initializeResult.readiness.code, 'ACP_PROTOCOL_INCOMPATIBLE')
      assert.equal(initializeResult.driver, undefined)
      assert.ok(disposeCalls > before)
    } finally {
      AcpSessionDriver.prototype.dispose = originalDispose
    }
  })
})

describe('readiness helpers', () => {
  it('maps spawn failures and prepared state', () => {
    const r = readinessForSpawnFailure({
      code: 'ACP_RUNNER_MISSING',
      message: 'npx not found',
    })
    assert.equal(r.status, 'failed')
    assert.equal(r.nextAction, 'install_runner')
    assert.equal(readinessPrepared().status, 'prepared')
  })
})
