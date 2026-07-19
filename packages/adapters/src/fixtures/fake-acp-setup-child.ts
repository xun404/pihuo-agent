import { appendFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentCapabilities,
  type AuthMethod,
} from '@agentclientprotocol/sdk'

const mode = process.argv[2] ?? 'ready-close'
const traceFile = process.env.ACP_FAKE_TRACE_FILE
let authenticated = false
let sessionNewCalls = 0

function trace(event: string): void {
  if (!traceFile) return
  appendFileSync(traceFile, `${process.pid}:${event}\n`, 'utf8')
}

function capabilities(): AgentCapabilities {
  if (mode === 'ready-close' || mode === 'auth') {
    return { sessionCapabilities: { close: {} } }
  }
  if (mode === 'ready-delete') {
    return { sessionCapabilities: { delete: {} } }
  }
  if (mode === 'logout' || mode === 'logout-fail') {
    return { auth: { logout: {} } }
  }
  return {}
}

function authMethods(): AuthMethod[] {
  if (mode !== 'auth') return []
  return [
    { id: 'oauth', name: 'OAuth' },
    { type: 'terminal', id: 'terminal', name: 'Terminal', args: ['login'] },
  ]
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (mode === 'hang-ignore-term' && signal === 'SIGTERM') {
      trace('signal:SIGTERM:ignored')
      return
    }
    trace(`signal:${signal}`)
    process.exit(0)
  })
}
process.on('exit', (code) => trace(`exit:${String(code)}`))
trace('fixture-ready')

const app = agent({ name: 'spawned-fixture' })
  .onRequest(methods.agent.initialize, async () => {
    trace('initialize')
    if (mode === 'early-exit') {
      setImmediate(() => process.exit(17))
      return await new Promise<never>(() => {})
    }
    if (mode === 'hang' || mode === 'hang-ignore-term') return await new Promise<never>(() => {})
    if (mode === 'initialize-error') {
      throw RequestError.internalError({
        stderr: process.env.ACP_TEST_SECRET,
        path: '/private/fixture/agent',
      })
    }
    return {
      protocolVersion: mode === 'protocol-mismatch' ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION,
      agentCapabilities: capabilities(),
      authMethods: authMethods(),
      agentInfo: { name: 'spawned-fixture', version: '1.0.0' },
    }
  })
  .onRequest(methods.agent.authenticate, async (ctx) => {
    trace(`authenticate:${ctx.params.methodId}`)
    authenticated = true
    return {}
  })
  .onRequest(methods.agent.session.new, async () => {
    sessionNewCalls += 1
    trace(`session-new:${String(sessionNewCalls)}`)
    if (mode === 'auth' && !authenticated) {
      throw RequestError.authRequired({ reason: 'auth_required' })
    }
    if (mode === 'session-error') {
      throw RequestError.internalError({
        stderr: process.env.ACP_TEST_SECRET,
        path: '/private/fixture/agent',
      })
    }
    return { sessionId: 'spawned-session', configOptions: [] }
  })
  .onRequest(methods.agent.session.close, async () => {
    trace('session-close')
    return {}
  })
  .onRequest(methods.agent.session.delete, async () => {
    trace('session-delete')
    return {}
  })
  .onRequest(methods.agent.logout, async () => {
    trace('logout')
    if (mode === 'logout-fail') {
      throw RequestError.internalError({ secret: process.env.ACP_TEST_SECRET })
    }
    return {}
  })

app.connect(
  ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  ),
)
