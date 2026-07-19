import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { IncomingMessage } from 'node:http'
import type { AcpAgentInstallationRecord } from '@swarmdesk-agent/core'
import type { SanitizedAuthMethod } from '@swarmdesk-agent/adapters'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import {
  cancelAllTerminalAuthAttempts,
  createTerminalAuthAttempt,
  getTerminalAuthAttempt,
  recordTerminalAuthProbeMethods,
  resetTerminalAuthAttemptsForTests,
  setPtyFeatureReadyForTests,
  type TerminalAuthPty,
} from './acp-auth-terminal.js'
import {
  extractTerminalAuthTokenFromUpgrade,
  handleTerminalAuthUpgrade,
  handleTerminalAuthSocket,
  parseTerminalAuthClientFrame,
  parseTerminalAuthUpgradePath,
  selectTerminalAuthSubprotocol,
} from './acp-auth-terminal-ws.js'

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage
}

class FakePty implements TerminalAuthPty {
  readonly pid = 7373
  readonly writes: string[] = []
  readonly resizes: Array<[number, number]> = []
  readonly kills: string[] = []
  private dataListener?: (data: string) => void
  private exitListener?: (event: { exitCode: number; signal?: number }) => void
  write(data: string): void {
    this.writes.push(data)
  }
  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows])
  }
  kill(signal = ''): void {
    this.kills.push(signal)
  }
  onData(listener: (data: string) => void) {
    this.dataListener = listener
    return {
      dispose: () => {
        this.dataListener = undefined
      },
    }
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListener = listener
    return {
      dispose: () => {
        this.exitListener = undefined
      },
    }
  }
  emitData(data: string): void {
    this.dataListener?.(data)
  }
  emitExit(exitCode: number): void {
    this.exitListener?.({ exitCode })
  }
}

type Listener = (...args: unknown[]) => void
class FakeWs {
  readyState = 1
  readonly sent: Array<Record<string, unknown>> = []
  readonly closes: Array<[number | undefined, string | undefined]> = []
  private readonly listeners = new Map<string, Listener>()
  on(event: string, listener: Listener): void {
    this.listeners.set(event, listener)
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close(code?: number, reason?: string): void {
    this.closes.push([code, reason])
    this.readyState = 3
  }
  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.(...args)
  }
}

function seededAttempt() {
  const worker: WorkerRegistration = {
    id: 'worker-1',
    name: 'Worker',
    kind: 'custom',
    command: '/stale',
    args: [],
    primaryRole: 'general',
    roles: ['general'],
    capabilities: [],
    enabled: true,
    scope: 'global',
    description: '',
    health: 'unknown',
    installationId: 'inst-1',
    source: {
      type: 'registry',
      registryId: 'agent-1',
      registryVersion: '1.0.0',
      registrySchemaVersion: '1',
      manifestDigest: 'digest-1',
      distribution: 'npx',
      installationId: 'inst-1',
    },
    capabilitySummary: { probedAt: '2026-07-17T00:00:00.000Z' },
  }
  const method: SanitizedAuthMethod = {
    id: 'terminal-login',
    type: 'terminal',
    terminalArgs: ['login'],
  }
  const installation: AcpAgentInstallationRecord = {
    installationId: 'inst-1',
    registryId: 'agent-1',
    registryVersion: '1.0.0',
    distribution: 'npx',
    manifestDigest: 'digest-1',
    installDir: '/trusted/agent',
    runnerCommand: '/trusted/npx',
    packageSpec: '@example/agent@1.0.0',
    launchSpec: {
      distribution: 'npx',
      runnerCommand: '/trusted/npx',
      runnerArgs: ['--offline'],
      packageSpec: '@example/agent@1.0.0',
      agentArgs: ['acp'],
      env: {},
    },
    status: 'prepared',
    workerIds: ['worker-1'],
  }
  recordTerminalAuthProbeMethods({ worker, methods: [method] })
  const owner = {
    findWorker: () => worker,
    findInstallation: () => installation,
    loadWorkerSecretsSnapshot: () => ({
      secrets: {},
      configuredKeys: [],
      revision: 0,
      revisionHmac: 'worker-secret-revision-0',
    }),
    ambientEnv: { PATH: '/usr/bin' },
  }
  const created = createTerminalAuthAttempt(
    {
      workerId: worker.id,
      methodId: method.id,
      worker,
      origin: 'http://localhost:5173',
      desktopToken: 'desktop-v1',
    },
    owner,
  )
  return { created, attempt: getTerminalAuthAttempt(created.attemptId)!, owner }
}

describe('acp-auth-terminal-ws', () => {
  beforeEach(() => {
    resetTerminalAuthAttemptsForTests()
    setPtyFeatureReadyForTests(true)
  })

  it('requires a safe protocol plus secret token protocol and never accepts query tokens', () => {
    const req = request({
      'sec-websocket-protocol': 'ra-auth-v1, ra-auth-token.abc123',
    })
    assert.equal(extractTerminalAuthTokenFromUpgrade(req), 'abc123')
    assert.equal(
      extractTerminalAuthTokenFromUpgrade(
        request({
          'sec-websocket-protocol': 'ra-auth-token.abc123',
        }),
      ),
      null,
    )
    assert.equal(
      extractTerminalAuthTokenFromUpgrade(
        request({
          'sec-websocket-protocol': 'ra-auth-v1, abc123',
        }),
      ),
      null,
    )
    assert.equal(
      parseTerminalAuthUpgradePath('/api/workers/worker-1/auth-terminal/attempt-1/ws?token=bad'),
      null,
    )
  })

  it('selects only the non-secret protocol for the WebSocket handshake', () => {
    assert.equal(
      selectTerminalAuthSubprotocol(new Set(['ra-auth-v1', 'ra-auth-token.secret'])),
      'ra-auth-v1',
    )
    assert.equal(selectTerminalAuthSubprotocol(new Set(['ra-auth-token.secret'])), false)
  })

  it('parses only bounded typed input, resize, and cancel frames', () => {
    assert.deepEqual(parseTerminalAuthClientFrame('{"type":"input","data":"hello"}'), {
      type: 'input',
      data: 'hello',
    })
    assert.deepEqual(parseTerminalAuthClientFrame('{"type":"resize","cols":120,"rows":40}'), {
      type: 'resize',
      cols: 120,
      rows: 40,
    })
    assert.deepEqual(parseTerminalAuthClientFrame('{"type":"cancel"}'), { type: 'cancel' })
    assert.throws(
      () => parseTerminalAuthClientFrame('{"type":"resize","cols":1,"rows":999}'),
      /frame/i,
    )
    assert.throws(() => parseTerminalAuthClientFrame('{"type":"shell","command":"id"}'), /frame/i)
    assert.throws(() => parseTerminalAuthClientFrame('x'.repeat(9_000)), /large/i)
  })

  it('routes typed frames to PTY and disconnect cancels/reaps without reflecting errors', () => {
    const { attempt, owner } = seededAttempt()
    const pty = new FakePty()
    const ws = new FakeWs()

    handleTerminalAuthSocket(attempt, ws, { ptySpawn: () => pty, owner })
    ws.emit('message', Buffer.from('{"type":"input","data":"alice\\r"}'))
    ws.emit('message', '{"type":"resize","cols":100,"rows":30}')
    pty.emitData('Password:')

    assert.deepEqual(pty.writes, ['alice\r'])
    assert.deepEqual(pty.resizes, [[100, 30]])
    assert.deepEqual(ws.sent.at(-1), { type: 'output', data: 'Password:' })

    ws.emit('message', '{"type":"invalid","private":"/Users/private"}')
    assert.deepEqual(ws.closes.at(-1), [1008, 'invalid frame'])
    assert.equal(JSON.stringify(ws.sent).includes('/Users/private'), false)
    assert.ok(pty.kills.length >= 1)
  })

  it('exit=0 reports exited and re-probe required, never authentication success', () => {
    const { attempt, owner } = seededAttempt()
    const pty = new FakePty()
    const ws = new FakeWs()
    handleTerminalAuthSocket(attempt, ws, { ptySpawn: () => pty, owner })
    pty.emitExit(0)

    assert.deepEqual(ws.sent.at(-1), {
      type: 'exit',
      code: 0,
      status: 'exited',
      nextAction: 're-probe',
    })
    assert.equal(
      ws.sent.some((event) => event.type === 'authenticated'),
      false,
    )
  })

  it('acknowledges a typed cancel before closing the socket', () => {
    const { attempt, owner } = seededAttempt()
    const ws = new FakeWs()
    handleTerminalAuthSocket(attempt, ws, { ptySpawn: () => new FakePty(), owner })
    ws.emit('message', '{"type":"cancel"}')

    assert.deepEqual(ws.sent.at(-1), { type: 'cancelled' })
    assert.deepEqual(ws.closes.at(-1), [1000, 'cancelled'])
    assert.equal(attempt.status, 'cancelled')
  })

  it('closes an active terminal socket while Owner shutdown drains its PTY', async () => {
    const { attempt, owner } = seededAttempt()
    const ws = new FakeWs()
    handleTerminalAuthSocket(attempt, ws, { ptySpawn: () => new FakePty(), owner })

    await cancelAllTerminalAuthAttempts({ graceMs: 0, reapMs: 0 })

    assert.deepEqual(ws.sent.at(-1), { type: 'error', code: 'WORKER_AUTH_FAILED' })
    assert.deepEqual(ws.closes.at(-1), [1011, 'terminal failed'])
    assert.equal(attempt.status, 'cancelled')
  })

  it('emits only error/1011 when PTY spawn throws, with no ready or exit race', () => {
    const { attempt, owner } = seededAttempt()
    const ws = new FakeWs()

    handleTerminalAuthSocket(attempt, ws, {
      owner,
      ptySpawn: () => {
        throw new Error('native spawn failed')
      },
    })

    assert.deepEqual(ws.sent, [{ type: 'error', code: 'WORKER_AUTH_FAILED' }])
    assert.deepEqual(ws.closes, [[1011, 'terminal failed']])
    assert.equal(attempt.phase, 'spawn_error')
  })

  it('cancels a consumed attempt if the WebSocket handshake throws', async () => {
    const { created, attempt, owner } = seededAttempt()
    const req = {
      url: `/api/workers/worker-1/auth-terminal/${created.attemptId}/ws`,
      headers: {
        origin: 'http://localhost:5173',
        'sec-websocket-protocol': `ra-auth-v1, ra-auth-token.${created.token}`,
      },
    } as IncomingMessage
    let destroyed = false
    const socket = {
      write: () => true,
      destroy: () => {
        destroyed = true
      },
    }
    const handled = await handleTerminalAuthUpgrade(req, socket as never, Buffer.alloc(0), {
      desktopToken: 'desktop-v1',
      server: {
        handleUpgrade: () => {
          throw new Error('handshake failed')
        },
      },
      owner,
    })

    assert.equal(handled, true)
    assert.equal(attempt.status, 'cancelled')
    assert.equal(destroyed, true)
  })
})
