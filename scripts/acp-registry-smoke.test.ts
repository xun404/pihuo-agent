import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  MAX_SMOKE_AGENTS,
  SmokeUsageError,
  createSmokeIsolation,
  forceKillTree,
  parseSmokeArgs,
  runSmokeController,
} from './acp-registry-smoke-control.mjs'
import { runRegistrySmoke } from './acp-registry-smoke-runner-lib.js'

const NOOP_RUNNER_FIXTURE = fileURLToPath(
  new URL('./fixtures/acp-registry-smoke-noop-runner.ts', import.meta.url),
)
const OVERFLOW_RUNNER_FIXTURE = fileURLToPath(
  new URL('./fixtures/acp-registry-smoke-overflow-runner.ts', import.meta.url),
)

describe('ACP Registry opt-in smoke control', () => {
  it('refuses execution unless confirmation and an explicit allowlist are both present', () => {
    assert.throws(
      () => parseSmokeArgs(['--agents', 'fixture:npx']),
      (error: unknown) => error instanceof SmokeUsageError && error.exitCode === 2,
    )
    assert.throws(
      () => parseSmokeArgs(['--confirm-third-party-execution']),
      (error: unknown) => error instanceof SmokeUsageError && error.exitCode === 2,
    )
  })

  it('parses bounded agent/distribution selections without accepting arbitrary values', () => {
    const parsed = parseSmokeArgs([
      '--confirm-third-party-execution',
      '--agents',
      'fixture-a:npx,fixture-b:binary',
      '--timeout-ms=42000',
      '--json',
    ])
    assert.deepEqual(parsed.agents, [
      { registryId: 'fixture-a', distribution: 'npx' },
      { registryId: 'fixture-b', distribution: 'binary' },
    ])
    assert.equal(parsed.timeoutMs, 42_000)
    assert.equal(parsed.json, true)

    assert.throws(
      () => parseSmokeArgs(['--confirm-third-party-execution', '--agents', 'fixture-a:shell']),
      /distribution/i,
    )
    assert.throws(
      () => parseSmokeArgs(['--confirm-third-party-execution', '--agents', '../escape:npx']),
      /agent id/i,
    )
    assert.throws(
      () =>
        parseSmokeArgs([
          '--confirm-third-party-execution',
          '--agents',
          Array.from({ length: MAX_SMOKE_AGENTS + 1 }, (_, i) => `agent-${i}:npx`).join(','),
        ]),
      /at most/i,
    )
  })

  it('builds a private isolated HOME, data, cwd, XDG and package cache environment', () => {
    const isolation = createSmokeIsolation({
      PATH: '/safe/bin',
      LANG: 'en_US.UTF-8',
      OPENAI_API_KEY: 'must-not-cross',
      npm_config_userconfig: '/real/home/.npmrc',
    })
    try {
      assert.equal(isolation.env.PATH, '/safe/bin')
      assert.equal(isolation.env.LANG, 'en_US.UTF-8')
      assert.equal(isolation.env.OPENAI_API_KEY, undefined)
      assert.equal(isolation.env.npm_config_userconfig, undefined)
      for (const key of [
        'HOME',
        'USERPROFILE',
        'SWARMDESK_AGENT_DATA_DIR',
        'SWARMDESK_AGENT_AGENTS_DIR',
        'XDG_CACHE_HOME',
        'XDG_CONFIG_HOME',
        'XDG_DATA_HOME',
        'XDG_STATE_HOME',
        'npm_config_cache',
        'UV_CACHE_DIR',
        'PIP_CACHE_DIR',
        'TMPDIR',
        'TEMP',
        'TMP',
      ]) {
        const value = isolation.env[key]
        assert.equal(typeof value, 'string', key)
        assert.ok(value!.startsWith(isolation.root), `${key} escaped isolation`)
        assert.equal(existsSync(value!), true, `${key} was not created`)
      }
      assert.ok(isolation.cwd.startsWith(isolation.root))
    } finally {
      isolation.cleanup()
    }
    assert.equal(existsSync(isolation.root), false)
  })

  it('requests graceful runner shutdown on total timeout, bounds captured output, then cleans isolation', async () => {
    class FakeChild extends EventEmitter {
      pid = 123
      exitCode: number | null = null
      signalCode: NodeJS.Signals | null = null
      stdout = new EventEmitter()
      stderr = new EventEmitter()
      sent: unknown[] = []
      killed: NodeJS.Signals[] = []
      send(message: unknown) {
        this.sent.push(message)
      }
      kill(signal: NodeJS.Signals) {
        this.killed.push(signal)
        this.signalCode = signal
        queueMicrotask(() => this.emit('exit', null, signal))
        return true
      }
    }
    const child = new FakeChild()
    let cleaned = false
    const result = await runSmokeController({
      options: {
        confirmed: true,
        agents: [{ registryId: 'fixture', distribution: 'npx' }],
        timeoutMs: 5,
        json: true,
        allowUnverifiedBinary: false,
      },
      isolation: {
        root: '/isolated',
        cwd: '/isolated/cwd',
        env: { HOME: '/isolated/home' },
        cleanup: () => {
          cleaned = true
        },
      },
      spawnRunner: () => child as never,
      gracefulShutdownMs: 5,
    })
    assert.deepEqual(child.sent, [{ type: 'shutdown', reason: 'total_timeout' }])
    assert.deepEqual(child.killed, ['SIGKILL'])
    assert.equal(result.exitCode, 124)
    assert.equal(result.report.results[0]?.status, 'upstream_failed')
    assert.equal(result.report.results[0]?.code, 'SMOKE_TOTAL_TIMEOUT')
    assert.equal(cleaned, true)
  })

  it('cleans isolation when the internal runner cannot be spawned', async () => {
    let cleaned = false
    await assert.rejects(
      runSmokeController({
        options: {
          confirmed: true,
          agents: [{ registryId: 'fixture', distribution: 'npx' }],
          timeoutMs: 1_000,
          json: true,
          allowUnverifiedBinary: false,
        },
        isolation: {
          root: '/isolated',
          cwd: '/isolated/cwd',
          env: { HOME: '/isolated/home' },
          cleanup: () => {
            cleaned = true
          },
        },
        spawnRunner: () => {
          throw new Error('spawn unavailable')
        },
      }),
      /spawn unavailable/,
    )
    assert.equal(cleaned, true)
  })

  it('constructs only the internal TS product-path runner in the isolated cwd', async () => {
    class SuccessfulChild extends EventEmitter {
      pid = 456
      exitCode: number | null = null
      signalCode: NodeJS.Signals | null = null
      stdout = new EventEmitter()
      stderr = new EventEmitter()
      send() {}
      kill() {
        return true
      }
    }
    let spawnInput:
      | {
          command: string
          args: string[]
          cwd: string
          env: Record<string, string>
        }
      | undefined
    let cleaned = false
    const child = new SuccessfulChild()
    const outcomePromise = runSmokeController({
      options: {
        confirmed: true,
        agents: [{ registryId: 'fixture', distribution: 'npx' }],
        timeoutMs: 1_000,
        json: true,
        allowUnverifiedBinary: false,
      },
      isolation: {
        root: '/isolated',
        cwd: '/isolated/cwd',
        env: { HOME: '/isolated/home' },
        cleanup: () => {
          cleaned = true
        },
      },
      spawnRunner: (input) => {
        spawnInput = input
        queueMicrotask(() => {
          child.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                ok: true,
                results: [
                  {
                    registryId: 'fixture',
                    distribution: 'npx',
                    status: 'pass',
                    code: 'SESSION_READY',
                  },
                ],
              }),
            ),
          )
          child.exitCode = 0
          child.emit('exit', 0, null)
        })
        return child as never
      },
    })
    const outcome = await outcomePromise
    assert.equal(spawnInput?.command, process.execPath)
    assert.equal(spawnInput?.args[0], '--import')
    assert.match(spawnInput?.args[1] ?? '', /^file:.*\/tsx\/dist\/loader\.mjs$/)
    assert.match(spawnInput?.args[2] ?? '', /acp-registry-smoke-runner\.ts$/)
    assert.equal(spawnInput?.cwd, '/isolated/cwd')
    assert.deepEqual(spawnInput?.env, { HOME: '/isolated/home' })
    assert.equal(outcome.exitCode, 0)
    assert.equal(cleaned, true)
  })

  it('loads an inert TypeScript runner with an absolute loader from the empty isolated cwd', async () => {
    const isolation = createSmokeIsolation({ PATH: process.env.PATH })
    const root = isolation.root
    const outcome = await runSmokeController({
      options: {
        confirmed: true,
        agents: [{ registryId: 'fixture', distribution: 'npx' }],
        timeoutMs: 5_000,
        json: true,
        allowUnverifiedBinary: false,
      },
      isolation,
      runnerPath: NOOP_RUNNER_FIXTURE,
      gracefulShutdownMs: 100,
    })
    assert.equal(outcome.exitCode, 0)
    assert.deepEqual(outcome.report.results, [
      {
        registryId: 'fixture',
        distribution: 'npx',
        status: 'pass',
        code: 'SESSION_READY',
      },
    ])
    assert.equal(existsSync(root), false)
  })

  it('fails closed on real oversized stdout while suppressing private oversized stderr', async () => {
    const isolation = createSmokeIsolation({ PATH: process.env.PATH })
    const outcome = await runSmokeController({
      options: {
        confirmed: true,
        agents: [{ registryId: 'fixture', distribution: 'npx' }],
        timeoutMs: 5_000,
        json: true,
        allowUnverifiedBinary: false,
      },
      isolation,
      runnerPath: OVERFLOW_RUNNER_FIXTURE,
      gracefulShutdownMs: 100,
    })
    assert.equal(outcome.exitCode, 1)
    assert.equal(outcome.report.results[0]?.code, 'SMOKE_OUTPUT_LIMIT')
    const publicJson = JSON.stringify(outcome.report)
    assert.ok(Buffer.byteLength(publicJson, 'utf8') < 1_024)
    assert.doesNotMatch(publicJson, /private-output-marker|Users\/alice|token=|super-secret/)
  })

  it('uses parameterized taskkill tree termination on Windows', () => {
    const calls: Array<{ file: string; args: string[]; options: unknown }> = []
    const directSignals: string[] = []
    forceKillTree(
      {
        pid: 789,
        kill: (signal: string) => {
          directSignals.push(signal)
          return true
        },
      },
      {
        platform: 'win32',
        execFileImpl: (file, args, options, callback) => {
          calls.push({ file, args, options })
          callback(null)
          return {} as never
        },
      },
    )
    assert.deepEqual(calls, [
      {
        file: 'taskkill.exe',
        args: ['/PID', '789', '/T', '/F'],
        options: { windowsHide: true },
      },
    ])
    assert.deepEqual(directSignals, [])
  })
})

describe('ACP Registry smoke product-path orchestration', () => {
  it('reuses catalog prepare register and probe APIs, preserving auth_required as a non-protocol result', async () => {
    const calls: string[] = []
    const signal = new AbortController().signal
    const result = await runRegistrySmoke({
      selections: [{ registryId: 'fixture-agent', distribution: 'npx' }],
      allowUnverifiedBinary: false,
      shouldStop: () => false,
      signal,
      services: {
        getCatalog: async () => {
          calls.push('catalog')
          return {
            agentsV2: [
              {
                id: 'fixture-agent',
                name: 'Fixture Agent',
                version: '1.2.3',
                manifestDigest: 'digest',
                distributions: [{ kind: 'npx', package: 'fixture-agent@1.2.3' }],
              },
            ],
          }
        },
        prepare: async (body) => {
          calls.push(`prepare:${body.registryId}:${body.distribution}`)
          return { installationId: 'installation-fixture' }
        },
        register: async (body) => {
          calls.push(`register:${body.registryId}:${body.installationId}`)
          return { worker: { id: 'worker-fixture' } }
        },
        probe: async (workerId) => {
          calls.push(`probe:${workerId}`)
          return {
            worker: {
              readiness: {
                status: 'auth_required',
                code: 'WORKER_AUTH_REQUIRED',
                nextAction: 'authenticate',
              },
            },
          }
        },
        publicError: () => ({
          error: 'Registry operation failed',
          code: 'ACP_INSTALL_FAILED',
          status: 500,
        }),
      },
    })
    assert.deepEqual(calls, [
      'catalog',
      'prepare:fixture-agent:npx',
      'register:fixture-agent:installation-fixture',
      'probe:worker-fixture',
    ])
    assert.deepEqual(result, [
      {
        registryId: 'fixture-agent',
        distribution: 'npx',
        status: 'auth_required',
        code: 'WORKER_AUTH_REQUIRED',
        nextAction: 'authenticate',
      },
    ])
  })

  it('classifies safe result codes and never returns private thrown messages', async () => {
    const signal = new AbortController().signal
    const result = await runRegistrySmoke({
      selections: [
        { registryId: 'runner', distribution: 'uvx' },
        { registryId: 'platform', distribution: 'binary' },
        { registryId: 'private', distribution: 'npx' },
      ],
      allowUnverifiedBinary: false,
      shouldStop: () => false,
      signal,
      services: {
        getCatalog: async () => ({
          agentsV2: [
            { id: 'runner', version: '1', manifestDigest: 'd1', distributions: [{ kind: 'uvx' }] },
            {
              id: 'platform',
              version: '1',
              manifestDigest: 'd2',
              distributions: [{ kind: 'binary' }],
            },
            { id: 'private', version: '1', manifestDigest: 'd3', distributions: [{ kind: 'npx' }] },
          ],
        }),
        prepare: async (body) => {
          const code =
            body.registryId === 'runner'
              ? 'ACP_RUNNER_MISSING'
              : body.registryId === 'platform'
                ? 'ACP_PLATFORM_UNSUPPORTED'
                : 'ACP_INSTALL_FAILED'
          throw Object.assign(new Error('/Users/alice token=super-secret'), { code })
        },
        register: async () => {
          throw new Error('unexpected')
        },
        probe: async () => {
          throw new Error('unexpected')
        },
        publicError: (error) => ({
          error: 'Registry operation failed',
          code: String((error as { code?: string }).code ?? 'ACP_INSTALL_FAILED'),
          status: 400,
        }),
      },
    })
    assert.deepEqual(
      result.map((entry) => entry.status),
      ['runner_missing', 'platform_unsupported', 'upstream_failed'],
    )
    assert.doesNotMatch(JSON.stringify(result), /alice|super-secret|Users/)
  })

  it('does not start register or probe after shutdown is requested during prepare', async () => {
    let stopping = false
    const calls: string[] = []
    const result = await runRegistrySmoke({
      selections: [{ registryId: 'fixture', distribution: 'npx' }],
      allowUnverifiedBinary: false,
      shouldStop: () => stopping,
      signal: new AbortController().signal,
      services: {
        getCatalog: async () => ({
          agentsV2: [
            {
              id: 'fixture',
              version: '1',
              manifestDigest: 'digest',
              distributions: [{ kind: 'npx' }],
            },
          ],
        }),
        prepare: async () => {
          calls.push('prepare')
          stopping = true
          return { installationId: 'installation' }
        },
        register: async () => {
          calls.push('register')
          return { worker: { id: 'worker' } }
        },
        probe: async () => {
          calls.push('probe')
          return { worker: { readiness: { status: 'ready', code: 'SESSION_READY' } } }
        },
        publicError: () => ({ error: 'failed', code: 'ACP_INSTALL_FAILED', status: 500 }),
      },
    })
    assert.deepEqual(calls, ['prepare'])
    assert.equal(result[0]?.code, 'SMOKE_INTERRUPTED')
  })

  it('forwards one AbortSignal into an active prepare and starts no later stage after abort', async () => {
    const controller = new AbortController()
    const calls: string[] = []
    let prepareSignal: AbortSignal | undefined
    let prepareStarted!: () => void
    const started = new Promise<void>((resolve) => {
      prepareStarted = resolve
    })
    const pending = runRegistrySmoke({
      selections: [{ registryId: 'fixture', distribution: 'binary' }],
      allowUnverifiedBinary: false,
      shouldStop: () => controller.signal.aborted,
      signal: controller.signal,
      services: {
        getCatalog: async () => ({
          agentsV2: [
            {
              id: 'fixture',
              version: '1',
              manifestDigest: 'digest',
              distributions: [{ kind: 'binary' }],
            },
          ],
        }),
        prepare: async (_body, options) => {
          calls.push('prepare')
          prepareStarted()
          prepareSignal = options?.signal
          if (!options) throw new Error('missing prepare signal options')
          await new Promise<never>((_resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('cancelled'), { code: 'ACP_INSTALL_FAILED' })),
              { once: true },
            )
          })
        },
        register: async () => {
          calls.push('register')
          return { worker: { id: 'worker' } }
        },
        probe: async () => {
          calls.push('probe')
          return { worker: { readiness: { status: 'ready', code: 'SESSION_READY' } } }
        },
        publicError: () => ({ error: 'failed', code: 'ACP_INSTALL_FAILED', status: 400 }),
      },
    })
    await started
    controller.abort()
    const result = await pending
    assert.equal(prepareSignal, controller.signal)
    assert.deepEqual(calls, ['prepare'])
    assert.equal(result[0]?.code, 'SMOKE_INTERRUPTED')
  })

  it('forwards the same AbortSignal into an active probe and awaits its cancellation cleanup', async () => {
    const controller = new AbortController()
    const calls: string[] = []
    let probeSignal: AbortSignal | undefined
    let probeStarted!: () => void
    const started = new Promise<void>((resolve) => {
      probeStarted = resolve
    })
    const pending = runRegistrySmoke({
      selections: [{ registryId: 'fixture', distribution: 'npx' }],
      allowUnverifiedBinary: false,
      shouldStop: () => controller.signal.aborted,
      signal: controller.signal,
      services: {
        getCatalog: async () => ({
          agentsV2: [
            {
              id: 'fixture',
              version: '1',
              manifestDigest: 'digest',
              distributions: [{ kind: 'npx' }],
            },
          ],
        }),
        prepare: async () => {
          calls.push('prepare')
          return { installationId: 'installation' }
        },
        register: async () => {
          calls.push('register')
          return { worker: { id: 'worker' } }
        },
        probe: async (_workerId, options) => {
          calls.push('probe')
          probeStarted()
          probeSignal = options?.signal
          if (!options) throw new Error('missing probe signal options')
          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          return {
            worker: {
              readiness: {
                status: 'failed',
                code: 'PROBE_ABORTED',
                nextAction: 'retry',
              },
            },
          }
        },
        publicError: () => ({ error: 'failed', code: 'ACP_INSTALL_FAILED', status: 400 }),
      },
    })
    await started
    controller.abort()
    const result = await pending
    assert.equal(probeSignal, controller.signal)
    assert.deepEqual(calls, ['prepare', 'register', 'probe'])
    assert.equal(result[0]?.code, 'SMOKE_INTERRUPTED')
  })
})
