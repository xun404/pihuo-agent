import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import type { AcpAgentInstallationRecord } from '@swarmdesk-agent/core'
import type { SanitizedAuthMethod } from '@swarmdesk-agent/adapters'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import {
  cancelAllTerminalAuthAttempts,
  cancelTerminalAuthAttempt,
  consumeTerminalAuthToken as consumeTerminalAuthTokenImplementation,
  createTerminalAuthAttempt,
  drainTerminalAuthAttemptsForShutdown,
  getTerminalAuthAttempt,
  isPtyFeatureReady,
  isTerminalAuthFeatureEnabled,
  recordTerminalAuthProbeMethods,
  resetTerminalAuthAttemptsForTests,
  resizeTerminalAuth,
  setPtyFeatureReadyForTests,
  startTerminalAuthProcess as startTerminalAuthProcessImplementation,
  terminalAuthAttemptPublicStatus,
  TERMINAL_AUTH_MAX_RETAINED_STATUSES,
  TERMINAL_AUTH_TTL_MS,
  TERMINAL_AUTH_FEATURE_ENV,
  TerminalAuthError,
  writeTerminalAuthInput,
  type TerminalAuthOwnerDependencies,
  type TerminalAuthPty,
} from './acp-auth-terminal.js'

function worker(overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
    id: 'w-term',
    name: 'Term Agent',
    kind: 'custom',
    command: '/private/stale/npx',
    args: ['--stale'],
    primaryRole: 'general',
    roles: ['general'],
    capabilities: [],
    enabled: true,
    scope: 'global',
    description: '',
    health: 'unknown',
    installationId: 'inst-term',
    source: {
      type: 'registry',
      registryId: 'term-agent',
      registryVersion: '1.0.0',
      registrySchemaVersion: '1',
      manifestDigest: 'digest-term',
      distribution: 'npx',
      installationId: 'inst-term',
    },
    authRevision: 2,
    capabilitySummary: { probedAt: '2026-07-17T01:02:03.000Z' },
    ...overrides,
  }
}

function installation(
  overrides: Partial<AcpAgentInstallationRecord> = {},
): AcpAgentInstallationRecord {
  return {
    installationId: 'inst-term',
    registryId: 'term-agent',
    registryVersion: '1.0.0',
    distribution: 'npx',
    manifestDigest: 'digest-term',
    installDir: '/private/router/agents/term-agent/1.0.0',
    runnerCommand: '/trusted/bin/npx',
    packageSpec: '@example/agent@1.0.0',
    launchSpec: {
      distribution: 'npx',
      runnerCommand: '/trusted/bin/npx',
      runnerArgs: ['--offline', '--package-cache=/trusted/cache'],
      packageSpec: '@example/agent@1.0.0',
      agentArgs: ['acp', '--stdio'],
      env: { INSTALLATION_FLAG: 'yes' },
    },
    status: 'prepared',
    workerIds: ['w-term'],
    ...overrides,
  }
}

const terminalMethod: SanitizedAuthMethod = {
  id: 'login',
  type: 'terminal',
  terminalArgs: ['auth', 'login'],
  terminalEnvKeys: ['TERM'],
  terminalEnv: { TERM: 'xterm-256color' },
}

function deps(
  record: AcpAgentInstallationRecord = installation(),
  current: WorkerRegistration = worker(),
): TerminalAuthOwnerDependencies {
  return {
    findWorker: () => current,
    findInstallation: () => record,
    loadWorkerSecretsSnapshot: () => ({
      secrets: { AGENT_SESSION_SECRET: 'worker-only-secret' },
      configuredKeys: ['AGENT_SESSION_SECRET'],
      revision: 1,
      revisionHmac: 'worker-secret-revision-1',
    }),
    ambientEnv: {
      PATH: '/usr/bin',
      HOME: '/Users/private',
      SWARMDESK_AGENT_DESKTOP_TOKEN: 'must-not-forward',
    },
  }
}

function consumeTerminalAuthToken(
  input: Parameters<typeof consumeTerminalAuthTokenImplementation>[0],
  owner: TerminalAuthOwnerDependencies = deps(),
) {
  return consumeTerminalAuthTokenImplementation(input, owner)
}

function startTerminalAuthProcess(
  attempt: Parameters<typeof startTerminalAuthProcessImplementation>[0],
  handlers: Parameters<typeof startTerminalAuthProcessImplementation>[1],
  dependencies: Parameters<typeof startTerminalAuthProcessImplementation>[2] = {},
) {
  return startTerminalAuthProcessImplementation(attempt, handlers, {
    owner: deps(),
    ...dependencies,
  })
}

function seedPrivateMethod(target = worker()): void {
  recordTerminalAuthProbeMethods({ worker: target, methods: [terminalMethod] })
}

function create(target = worker(), overrides: { origin?: string } = {}) {
  seedPrivateMethod(target)
  return createTerminalAuthAttempt(
    {
      workerId: target.id,
      methodId: 'login',
      worker: target,
      desktopToken: 'desktop-capability-v1',
      ...(Object.hasOwn(overrides, 'origin') ? { origin: overrides.origin } : {}),
    },
    deps(installation(), target),
  )
}

class FakePty implements TerminalAuthPty {
  readonly pid = 4242
  readonly writes: string[] = []
  readonly resizes: Array<[number, number]> = []
  readonly kills: Array<string | undefined> = []
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  constructor(private readonly rejectSignal = false) {}

  write(data: string): void {
    this.writes.push(data)
  }
  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows])
  }
  kill(signal?: string): void {
    this.kills.push(signal)
    if (this.rejectSignal && signal !== undefined) throw new Error('signals unsupported')
  }
  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    return {
      dispose: () => {
        this.dataListeners.delete(listener)
      },
    }
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.add(listener)
    return {
      dispose: () => {
        this.exitListeners.delete(listener)
      },
    }
  }
  emitData(data: string): void {
    for (const listener of [...this.dataListeners]) listener(data)
  }
  emitExit(exitCode: number): void {
    for (const listener of [...this.exitListeners]) listener({ exitCode })
  }
}

describe('acp-auth-terminal', () => {
  const previousFeature = process.env[TERMINAL_AUTH_FEATURE_ENV]

  beforeEach(() => {
    resetTerminalAuthAttemptsForTests()
    setPtyFeatureReadyForTests(true)
    delete process.env[TERMINAL_AUTH_FEATURE_ENV]
  })

  after(() => {
    resetTerminalAuthAttemptsForTests()
    setPtyFeatureReadyForTests(null)
    if (previousFeature === undefined) delete process.env[TERMINAL_AUTH_FEATURE_ENV]
    else process.env[TERMINAL_AUTH_FEATURE_ENV] = previousFeature
  })

  it('resolves exact private terminal method and preserves immutable runner prefix', () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!

    assert.equal(attempt.command, '/trusted/bin/npx')
    assert.deepEqual(attempt.args, [
      '--offline',
      '--package-cache=/trusted/cache',
      '@example/agent@1.0.0',
      'auth',
      'login',
    ])
    assert.equal(attempt.args.includes('acp'), false)
    assert.equal(attempt.env.INSTALLATION_FLAG, 'yes')
    assert.equal(attempt.env.TERM, 'xterm-256color')
    assert.equal(attempt.env.AGENT_SESSION_SECRET, 'worker-only-secret')
    assert.equal(attempt.env.SWARMDESK_AGENT_DESKTOP_TOKEN, undefined)
    assert.equal(created.commandPreview.command, 'npx')
    assert.deepEqual(created.commandPreview.args, [])
  })

  it('fails closed without the process-private method cache and after probe boundary change', () => {
    assert.throws(
      () =>
        createTerminalAuthAttempt(
          {
            workerId: 'w-term',
            methodId: 'login',
            worker: worker(),
            desktopToken: 'desktop-capability-v1',
          },
          deps(),
        ),
      (error: unknown) => error instanceof TerminalAuthError && error.code === 'WORKER_AUTH_FAILED',
    )

    const previous = worker()
    seedPrivateMethod(previous)
    assert.throws(
      () =>
        createTerminalAuthAttempt(
          {
            workerId: 'w-term',
            methodId: 'login',
            worker: worker({ authRevision: 3 }),
            desktopToken: 'desktop-capability-v1',
          },
          deps(),
        ),
      /re-probe/i,
    )
  })

  it('rejects unsupported, duplicate, and non-terminal private method IDs', () => {
    for (const methods of [
      [{ id: 'login', type: 'agent' as const }],
      [{ id: 'login', type: 'unsupported' as const }],
      [terminalMethod, { ...terminalMethod }],
    ]) {
      resetTerminalAuthAttemptsForTests()
      const target = worker()
      recordTerminalAuthProbeMethods({ worker: target, methods })
      assert.throws(
        () =>
          createTerminalAuthAttempt(
            {
              workerId: target.id,
              methodId: 'login',
              worker: target,
              desktopToken: 'desktop-capability-v1',
            },
            deps(),
          ),
        /unavailable/i,
      )
    }
  })

  it('rejects Worker and immutable installation identity mismatches', () => {
    const target = worker()
    seedPrivateMethod(target)
    assert.throws(
      () =>
        createTerminalAuthAttempt(
          {
            workerId: target.id,
            methodId: 'login',
            worker: target,
            desktopToken: 'desktop-capability-v1',
          },
          deps(installation({ manifestDigest: 'different' })),
        ),
      (error: unknown) =>
        error instanceof TerminalAuthError && error.code === 'ACP_INSTALL_DIGEST_MISMATCH',
    )

    const targeted = worker({
      source: {
        type: 'registry',
        registryId: 'term-agent',
        registryVersion: '1.0.0',
        registrySchemaVersion: '1',
        manifestDigest: 'digest-term',
        distribution: 'npx',
        target: 'darwin-aarch64',
        installationId: 'inst-term',
      },
    })
    seedPrivateMethod(targeted)
    assert.throws(
      () =>
        createTerminalAuthAttempt(
          {
            workerId: targeted.id,
            methodId: 'login',
            worker: targeted,
            desktopToken: 'desktop-capability-v1',
          },
          deps(installation({ target: 'linux-x86_64' })),
        ),
      /installation facts do not match/i,
    )
  })

  it('uses the exact binary executable and replaces only ACP args', () => {
    const target = worker({
      source: {
        type: 'registry',
        registryId: 'term-agent',
        registryVersion: '1.0.0',
        registrySchemaVersion: '1',
        manifestDigest: 'digest-term',
        distribution: 'binary',
        installationId: 'inst-term',
      },
    })
    seedPrivateMethod(target)
    const record = installation({
      distribution: 'binary',
      resolvedExecutable: '/private/router/agents/term-agent/bin/agent',
      launchSpec: {
        distribution: 'binary',
        runnerArgs: [],
        agentArgs: ['acp'],
        env: {},
        executable: '/private/router/agents/term-agent/bin/agent',
      },
    })
    const created = createTerminalAuthAttempt(
      {
        workerId: target.id,
        methodId: 'login',
        worker: target,
        desktopToken: 'desktop-capability-v1',
      },
      deps(record),
    )

    const attempt = getTerminalAuthAttempt(created.attemptId)!
    assert.equal(attempt.command, '/private/router/agents/term-agent/bin/agent')
    assert.deepEqual(attempt.args, ['auth', 'login'])
    assert.equal(created.commandPreview.command, 'agent')
  })

  it('uses the materialized package executable and replaces only ACP args', () => {
    const target = worker()
    seedPrivateMethod(target)
    const executable = '/private/router/agents/term-agent/node_modules/@example/agent/bin/agent.js'
    const interpreter = '/trusted/bin/node'
    const record = installation({
      resolvedExecutable: executable,
      launchSpec: {
        distribution: 'npx',
        runnerCommand: '/trusted/bin/npx',
        runnerArgs: ['--yes'],
        packageSpec: '@example/agent@1.0.0',
        executable,
        interpreter,
        agentArgs: ['acp', '--stdio'],
        env: {},
      },
    })
    const created = createTerminalAuthAttempt(
      {
        workerId: target.id,
        methodId: 'login',
        worker: target,
        desktopToken: 'desktop-capability-v1',
      },
      deps(record),
    )

    const attempt = getTerminalAuthAttempt(created.attemptId)!
    assert.equal(attempt.command, interpreter)
    assert.deepEqual(attempt.args, [executable, 'auth', 'login'])
  })

  it('binds one-time token to worker, method, attempt, exact Origin, and current Desktop token', () => {
    const created = create(worker(), { origin: 'http://localhost:5173' })

    assert.throws(
      () =>
        consumeTerminalAuthToken({
          token: created.token,
          workerId: 'other',
          methodId: 'login',
          attemptId: created.attemptId,
          origin: 'http://localhost:5173',
          desktopToken: 'desktop-capability-v1',
        }),
      /worker mismatch/i,
    )

    assert.throws(
      () =>
        consumeTerminalAuthToken({
          token: created.token,
          workerId: 'w-term',
          methodId: 'login',
          attemptId: created.attemptId,
          desktopToken: 'desktop-capability-v1',
        }),
      /Origin/i,
    )

    assert.throws(
      () =>
        consumeTerminalAuthToken({
          token: created.token,
          workerId: 'w-term',
          methodId: 'login',
          attemptId: created.attemptId,
          origin: 'http://localhost:5173',
          desktopToken: 'desktop-capability-v2',
        }),
      /Desktop/i,
    )

    const consumed = consumeTerminalAuthToken({
      token: created.token,
      workerId: 'w-term',
      methodId: 'login',
      attemptId: created.attemptId,
      origin: 'http://localhost:5173',
      desktopToken: 'desktop-capability-v1',
    })
    assert.equal(consumed.attemptId, created.attemptId)
    assert.throws(
      () =>
        consumeTerminalAuthToken({
          token: created.token,
          workerId: 'w-term',
          methodId: 'login',
          attemptId: created.attemptId,
          origin: 'http://localhost:5173',
          desktopToken: 'desktop-capability-v1',
        }),
      /Invalid|used/i,
    )
  })

  it('fails closed when Worker, installation, probe, or secret revision changes while pending', () => {
    let currentWorker = worker()
    let currentInstallation = installation()
    let secretRevision = 1
    const owner: TerminalAuthOwnerDependencies = {
      findWorker: () => currentWorker,
      findInstallation: () => currentInstallation,
      loadWorkerSecretsSnapshot: () => ({
        secrets: { AGENT_SESSION_SECRET: `secret-${secretRevision}` },
        configuredKeys: ['AGENT_SESSION_SECRET'],
        revision: secretRevision,
        revisionHmac: `secret-revision-${secretRevision}`,
      }),
      ambientEnv: { PATH: '/usr/bin' },
    }
    const createBound = () => {
      seedPrivateMethod(currentWorker)
      const created = createTerminalAuthAttempt(
        {
          workerId: currentWorker.id,
          methodId: 'login',
          worker: currentWorker,
          desktopToken: 'desktop-capability-v1',
        },
        owner,
      )
      return { created, attempt: getTerminalAuthAttempt(created.attemptId)! }
    }
    const consumeBound = (created: ReturnType<typeof createTerminalAuthAttempt>) =>
      consumeTerminalAuthTokenImplementation(
        {
          token: created.token,
          workerId: currentWorker.id,
          methodId: 'login',
          attemptId: created.attemptId,
          desktopToken: 'desktop-capability-v1',
        },
        owner,
      )

    const secretBound = createBound()
    secretRevision = 2
    assert.throws(() => consumeBound(secretBound.created), /boundary changed/i)
    assert.equal(secretBound.attempt.phase, 'execution_boundary_changed')
    assert.deepEqual(secretBound.attempt.env, {})

    const installationBound = createBound()
    currentInstallation = installation({
      runnerCommand: '/trusted/bin/npx-v2',
      launchSpec: {
        ...installation().launchSpec!,
        runnerCommand: '/trusted/bin/npx-v2',
      },
    })
    assert.throws(() => consumeBound(installationBound.created), /boundary changed/i)
    assert.equal(installationBound.attempt.phase, 'execution_boundary_changed')

    currentInstallation = installation()
    const probeBound = createBound()
    currentWorker = worker({
      authRevision: 3,
      capabilitySummary: { probedAt: '2026-07-17T02:00:00.000Z' },
    })
    recordTerminalAuthProbeMethods({ worker: currentWorker, methods: [terminalMethod] })
    assert.equal(probeBound.attempt.phase, 'execution_boundary_changed')
    assert.throws(() => consumeBound(probeBound.created), /Invalid|expired/i)
  })

  it('revalidates once more at PTY spawn and never starts with a changed secret snapshot', () => {
    const target = worker()
    let secretRevision = 1
    const owner: TerminalAuthOwnerDependencies = {
      findWorker: () => target,
      findInstallation: () => installation(),
      loadWorkerSecretsSnapshot: () => ({
        secrets: { AGENT_SESSION_SECRET: `secret-${secretRevision}` },
        configuredKeys: ['AGENT_SESSION_SECRET'],
        revision: secretRevision,
        revisionHmac: `secret-revision-${secretRevision}`,
      }),
      ambientEnv: { PATH: '/usr/bin' },
    }
    seedPrivateMethod(target)
    const created = createTerminalAuthAttempt(
      {
        workerId: target.id,
        methodId: 'login',
        worker: target,
        desktopToken: 'desktop-capability-v1',
      },
      owner,
    )
    const attempt = consumeTerminalAuthTokenImplementation(
      {
        token: created.token,
        workerId: target.id,
        methodId: 'login',
        attemptId: created.attemptId,
        desktopToken: 'desktop-capability-v1',
      },
      owner,
    )
    secretRevision = 2
    let spawned = false
    assert.throws(
      () =>
        startTerminalAuthProcessImplementation(
          attempt,
          {
            onData: () => {},
            onExit: () => {},
          },
          {
            owner,
            ptySpawn: () => {
              spawned = true
              return new FakePty()
            },
          },
        ),
      /boundary changed/i,
    )
    assert.equal(spawned, false)
    assert.equal(attempt.phase, 'execution_boundary_changed')
  })

  it('requires exact missing Origin binding rather than treating it as a wildcard', () => {
    const created = create()
    assert.throws(
      () =>
        consumeTerminalAuthToken({
          token: created.token,
          workerId: 'w-term',
          methodId: 'login',
          attemptId: created.attemptId,
          origin: 'http://localhost:5173',
          desktopToken: 'desktop-capability-v1',
        }),
      /Origin/i,
    )
  })

  it('rejects expired tokens and enforces the global concurrent-attempt bound', () => {
    const expired = create()
    getTerminalAuthAttempt(expired.attemptId)!.expiresAt = Date.now() - 1
    assert.throws(
      () =>
        consumeTerminalAuthToken({
          token: expired.token,
          workerId: 'w-term',
          methodId: 'login',
          attemptId: expired.attemptId,
          desktopToken: 'desktop-capability-v1',
        }),
      /expired/i,
    )

    resetTerminalAuthAttemptsForTests()
    create()
    create()
    assert.throws(
      () => create(),
      (error: unknown) => error instanceof TerminalAuthError && error.httpStatus === 429,
    )
  })

  it('actively expires an abandoned pending attempt and scrubs its secrets at TTL', () => {
    const originalSetTimeout = globalThis.setTimeout
    let fireExpiration: (() => void) | undefined
    globalThis.setTimeout = ((handler: (...args: never[]) => void, timeout?: number) => {
      if (timeout === TERMINAL_AUTH_TTL_MS) {
        fireExpiration = () => handler()
        return { unref() {} } as ReturnType<typeof setTimeout>
      }
      return originalSetTimeout(handler, timeout)
    }) as unknown as typeof setTimeout

    let created: ReturnType<typeof create>
    try {
      created = create()
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    attempt.expiresAt = Date.now() - 1
    assert.ok(fireExpiration)
    fireExpiration()

    assert.equal(attempt.status, 'failed')
    assert.equal(attempt.phase, 'expired')
    assert.equal(attempt.token, '')
    assert.equal(attempt.command, '')
    assert.deepEqual(attempt.args, [])
    assert.deepEqual(attempt.env, {})
    assert.throws(
      () =>
        consumeTerminalAuthToken({
          token: created.token,
          workerId: 'w-term',
          methodId: 'login',
          attemptId: created.attemptId,
          desktopToken: 'desktop-capability-v1',
        }),
      /Invalid|expired/i,
    )
  })

  it('uses only injected PTY for write, bounded resize, and exit=0 remains exited', () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    const pty = new FakePty()
    const output: string[] = []
    const exits: Array<number | null> = []

    startTerminalAuthProcess(
      attempt,
      {
        onData: (chunk) => output.push(chunk),
        onExit: (code) => exits.push(code),
      },
      { ptySpawn: () => pty },
    )
    pty.emitData('login: ')
    attempt.pty!.write('alice\r')
    resizeTerminalAuth(attempt, 120, 40)
    assert.throws(() => resizeTerminalAuth(attempt, 1, 1000), /dimensions/i)
    pty.emitExit(0)

    assert.deepEqual(output, ['login: '])
    assert.deepEqual(pty.writes, ['alice\r'])
    assert.deepEqual(pty.resizes, [[120, 40]])
    assert.deepEqual(exits, [0])
    assert.equal(attempt.status, 'exited')
    assert.equal(attempt.phase, 'exited')
  })

  it('drops the one-time token after consume and launch secrets after PTY spawn', () => {
    const created = create()
    const attempt = consumeTerminalAuthToken({
      token: created.token,
      workerId: 'w-term',
      methodId: 'login',
      attemptId: created.attemptId,
      desktopToken: 'desktop-capability-v1',
    })
    assert.equal(attempt.token, '')

    let spawnedSecret: string | undefined
    startTerminalAuthProcess(
      attempt,
      {
        onData: () => {},
        onExit: () => {},
      },
      {
        ptySpawn: (_command, _args, options) => {
          spawnedSecret = options.env.AGENT_SESSION_SECRET
          return new FakePty()
        },
      },
    )
    assert.equal(spawnedSecret, 'worker-only-secret')
    assert.deepEqual(attempt.args, [])
    assert.deepEqual(attempt.env, {})
    assert.equal(attempt.command, '')
  })

  it('enforces output total/rate limits and terminates the PTY', () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    const pty = new FakePty()
    const errors: string[] = []
    startTerminalAuthProcess(
      attempt,
      {
        onData: () => {},
        onExit: () => {},
        onError: (code) => errors.push(code),
      },
      {
        ptySpawn: () => pty,
        limits: { maxOutputBytes: 8, maxOutputBytesPerSecond: 6 },
      },
    )

    pty.emitData('1234567')
    assert.deepEqual(errors, ['WORKER_AUTH_FAILED'])
    assert.equal(attempt.status, 'failed')
    assert.ok(pty.kills.length >= 1)
  })

  it('enforces the cumulative output limit independently of the rate window', () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    const pty = new FakePty()
    startTerminalAuthProcess(
      attempt,
      {
        onData: () => {},
        onExit: () => {},
      },
      {
        ptySpawn: () => pty,
        limits: { maxOutputBytes: 8, maxOutputBytesPerSecond: 100 },
      },
    )
    pty.emitData('12345')
    pty.emitData('6789')
    assert.equal(attempt.status, 'failed')
    assert.equal(attempt.phase, 'output_limit')
  })

  it('cancels on idle/absolute deadline and owner shutdown reaps every PTY', async () => {
    const first = create()
    const firstAttempt = getTerminalAuthAttempt(first.attemptId)!
    const firstPty = new FakePty()
    startTerminalAuthProcess(
      firstAttempt,
      {
        onData: () => {},
        onExit: () => {},
      },
      { ptySpawn: () => firstPty, limits: { idleTimeoutMs: 10, absoluteTimeoutMs: 100 } },
    )

    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(firstAttempt.status, 'failed')
    assert.equal(firstAttempt.phase, 'idle_timeout')
    assert.ok(firstPty.kills.length >= 1)

    resetTerminalAuthAttemptsForTests()
    const second = create()
    const secondAttempt = getTerminalAuthAttempt(second.attemptId)!
    const secondPty = new FakePty()
    startTerminalAuthProcess(
      secondAttempt,
      {
        onData: () => {},
        onExit: () => {},
      },
      { ptySpawn: () => secondPty },
    )
    cancelAllTerminalAuthAttempts()
    assert.equal(secondAttempt.status, 'cancelled')
    assert.ok(secondPty.kills.length >= 1)
  })

  it('uses parameterized taskkill tree escalation and signal-less node-pty cleanup on Windows', async () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    const pty = new FakePty(true)
    const taskkill: Array<{ file: string; args: string[]; shell: boolean }> = []
    const termination = {
      platform: 'win32' as const,
      graceMs: 1,
      reapMs: 1,
      execFile: (
        file: string,
        args: string[],
        options: { shell: boolean },
        callback: (error: Error | null) => void,
      ) => {
        taskkill.push({ file, args: [...args], shell: options.shell })
        callback(null)
      },
    }
    startTerminalAuthProcess(
      attempt,
      {
        onData: () => {},
        onExit: () => {},
      },
      { ptySpawn: () => pty, termination },
    )

    await cancelTerminalAuthAttempt(created.attemptId, termination)

    assert.deepEqual(taskkill, [
      { file: 'taskkill', args: ['/PID', '4242', '/T'], shell: false },
      { file: 'taskkill', args: ['/PID', '4242', '/T', '/F'], shell: false },
    ])
    assert.deepEqual(pty.kills, [undefined])
  })

  it('awaits POSIX TERM to KILL escalation before Owner shutdown cleanup resolves', async () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    const pty = new FakePty()
    const groupKills: Array<[number, string]> = []
    const termination = {
      platform: 'darwin' as const,
      graceMs: 1,
      reapMs: 1,
      killProcessGroup: (pid: number, signal: string) => groupKills.push([pid, signal]),
    }
    startTerminalAuthProcess(
      attempt,
      {
        onData: () => {},
        onExit: () => {},
      },
      { ptySpawn: () => pty, termination },
    )

    await cancelAllTerminalAuthAttempts(termination)

    assert.deepEqual(groupKills, [
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL'],
    ])
    assert.deepEqual(pty.kills, ['SIGTERM', 'SIGKILL'])
  })

  it('awaits a PTY termination already detached by a runtime failure', async () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    const pty = new FakePty()
    const groupKills: Array<[number, string]> = []
    startTerminalAuthProcess(
      attempt,
      {
        onData: () => {},
        onExit: () => {},
      },
      {
        ptySpawn: () => pty,
        limits: { maxOutputBytes: 1, maxOutputBytesPerSecond: 100 },
        termination: {
          platform: 'darwin',
          graceMs: 20,
          reapMs: 1,
          killProcessGroup: (pid: number, signal: string) => groupKills.push([pid, signal]),
        },
      },
    )

    pty.emitData('too much output')
    assert.equal(getTerminalAuthAttempt(created.attemptId), undefined)

    let drained = false
    const drain = cancelAllTerminalAuthAttempts().then(() => {
      drained = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(drained, false)
    await drain

    assert.deepEqual(groupKills, [
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL'],
    ])
  })

  it('closes terminal admission before shutdown drain catches accepted tail work', async () => {
    const created = create()
    let stopAdmission: (() => void) | undefined
    const admissionStopped = new Promise<void>((resolve) => {
      stopAdmission = resolve
    })
    const drain = drainTerminalAuthAttemptsForShutdown({
      stopAdmission: () => admissionStopped,
      termination: { graceMs: 0, reapMs: 0 },
    })

    assert.throws(
      () => create(),
      (error: unknown) =>
        error instanceof TerminalAuthError &&
        error.code === 'WORKER_NOT_READY' &&
        error.httpStatus === 503,
    )
    assert.throws(
      () =>
        consumeTerminalAuthToken({
          token: created.token,
          workerId: 'w-term',
          methodId: 'login',
          attemptId: created.attemptId,
          desktopToken: 'desktop-capability-v1',
        }),
      (error: unknown) =>
        error instanceof TerminalAuthError &&
        error.code === 'WORKER_NOT_READY' &&
        error.httpStatus === 503,
    )

    stopAdmission?.()
    await drain
  })

  it('keeps the original failure handler when input refreshes the idle deadline', async () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    const pty = new FakePty()
    const errors: string[] = []
    startTerminalAuthProcess(
      attempt,
      {
        onData: () => {},
        onExit: () => {},
        onError: (code) => errors.push(code),
      },
      { ptySpawn: () => pty, limits: { idleTimeoutMs: 10, absoluteTimeoutMs: 100 } },
    )
    writeTerminalAuthInput(attempt, 'input\r')

    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepEqual(errors, ['WORKER_AUTH_FAILED'])
    assert.equal(attempt.phase, 'idle_timeout')
  })

  it('enforces the absolute deadline even while output keeps the attempt active', async () => {
    const created = create()
    const attempt = getTerminalAuthAttempt(created.attemptId)!
    const pty = new FakePty()
    startTerminalAuthProcess(
      attempt,
      {
        onData: () => {},
        onExit: () => {},
      },
      { ptySpawn: () => pty, limits: { idleTimeoutMs: 100, absoluteTimeoutMs: 10 } },
    )
    pty.emitData('active')
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(attempt.status, 'failed')
    assert.equal(attempt.phase, 'absolute_timeout')
  })

  it('feature flag off disables terminal auth without a pipe fallback', () => {
    process.env[TERMINAL_AUTH_FEATURE_ENV] = '0'
    assert.equal(isTerminalAuthFeatureEnabled(), false)
    assert.equal(isPtyFeatureReady(), false)
    assert.throws(() => create(), /disabled/i)
  })

  it('retains only bounded terminal status snapshots and releases live PTY state', () => {
    const completed: Array<{ id: string; attempt: ReturnType<typeof getTerminalAuthAttempt> }> = []
    for (let index = 0; index <= TERMINAL_AUTH_MAX_RETAINED_STATUSES; index += 1) {
      const created = create()
      const attempt = getTerminalAuthAttempt(created.attemptId)!
      const pty = new FakePty()
      startTerminalAuthProcess(
        attempt,
        {
          onData: () => {},
          onExit: () => {},
        },
        { ptySpawn: () => pty },
      )
      pty.emitExit(0)
      completed.push({ id: created.attemptId, attempt })
    }

    assert.equal(terminalAuthAttemptPublicStatus('w-term', completed[0]!.id), null)
    assert.equal(terminalAuthAttemptPublicStatus('w-term', completed.at(-1)!.id)?.status, 'exited')
    const last = completed.at(-1)!.attempt!
    assert.equal(last.token, '')
    assert.equal(last.pty, undefined)
    assert.equal(last.runtime, undefined)
  })

  it('cancel remains safe for unknown attempt', () => {
    cancelTerminalAuthAttempt('missing')
  })
})
