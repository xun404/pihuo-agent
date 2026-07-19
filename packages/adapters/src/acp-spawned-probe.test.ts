import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'node:test'
import { logoutSpawnedAgent, probeSpawnedAgent, type SpawnedAcpSetupInput } from './index.js'
import { terminateSpawnedProcessTreeForTests } from './acp-capability-probe.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-acp-setup-child.ts', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixtureLaunch(
  mode: string,
  overrides: Partial<SpawnedAcpSetupInput> = {},
): {
  input: SpawnedAcpSetupInput
  traceFile: string
  secret: string
} {
  const dir = mkdtempSync(join(tmpdir(), 'acp-spawned-probe-'))
  tempDirs.push(dir)
  const traceFile = join(dir, 'trace.log')
  const secret = 'should-never-escape-setup'
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP']
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return {
    input: {
      command: process.execPath,
      args: ['--import', 'tsx', FIXTURE, mode],
      cwd: process.cwd(),
      env: {
        ...env,
        ACP_FAKE_TRACE_FILE: traceFile,
        ACP_TEST_SECRET: secret,
      },
      // The fake Agent starts through the tsx loader in a separate process.
      // Keep ordinary protocol assertions independent of cold-start contention;
      // the dedicated timeout case below still overrides this to 2 seconds.
      timeoutMs: 5_000,
      terminalAuthReady: false,
      ...overrides,
    },
    traceFile,
    secret,
  }
}

function readTrace(traceFile: string): string {
  try {
    return readFileSync(traceFile, 'utf8')
  } catch {
    return ''
  }
}

async function waitForTrace(
  traceFile: string,
  pattern: RegExp,
  timeoutMs = 2_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const trace = readTrace(traceFile)
    if (pattern.test(trace)) return trace
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('fixture did not become ready before the test deadline')
}

function assertPublicResultIsSanitized(result: unknown, ...forbidden: string[]): void {
  const json = JSON.stringify(result)
  for (const text of forbidden) assert.equal(json.includes(text), false, `leaked ${text}`)
}

describe('probeSpawnedAgent', () => {
  it('reaches ready over a real child stdio transport, cleans the setup session, and reaps', async () => {
    const { input, traceFile } = fixtureLaunch('ready-close')
    const result = await probeSpawnedAgent(input)
    assert.equal(result.readiness.status, 'ready')
    assert.equal(result.readiness.code, 'SESSION_READY')
    const trace = readTrace(traceFile)
    assert.match(trace, /:initialize/)
    assert.match(trace, /:session-new:1/)
    assert.match(trace, /:session-close/)
    assert.match(trace, /:signal:SIGTERM/)
    assert.match(trace, /:exit:0/)
  })

  it('authenticates an advertised agent method and retries session/new on the same child', async () => {
    const { input, traceFile } = fixtureLaunch('auth', { authenticateMethodId: 'oauth' })
    const result = await probeSpawnedAgent(input)
    assert.equal(result.readiness.status, 'ready')
    const lines = readTrace(traceFile).trim().split('\n')
    const pids = new Set(lines.map((line) => line.split(':', 1)[0]))
    assert.equal(pids.size, 1)
    assert.ok(lines.some((line) => line.endsWith(':session-new:1')))
    assert.ok(lines.some((line) => line.endsWith(':authenticate:oauth')))
    assert.ok(lines.some((line) => line.endsWith(':session-new:2')))
  })

  it('rejects a wrong or terminal method before authenticate', async () => {
    for (const authenticateMethodId of ['missing', 'terminal']) {
      const { input, traceFile } = fixtureLaunch('auth', { authenticateMethodId })
      const result = await probeSpawnedAgent(input)
      assert.equal(result.readiness.code, 'WORKER_AUTH_FAILED')
      assert.equal(readTrace(traceFile).includes(':authenticate:'), false)
      assert.match(readTrace(traceFile), /:exit:0/)
    }
  })

  it('maps protocol mismatch, initialize failure, and session failure to stable sanitized results', async () => {
    const cases = [
      ['protocol-mismatch', 'ACP_PROTOCOL_INCOMPATIBLE'],
      ['initialize-error', 'INITIALIZE_FAILED'],
      ['session-error', 'SESSION_FAILED'],
    ] as const
    for (const [mode, code] of cases) {
      const { input, traceFile, secret } = fixtureLaunch(mode)
      const result = await probeSpawnedAgent(input)
      assert.equal(result.readiness.code, code)
      assert.match(readTrace(traceFile), /:exit:0/)
      assertPublicResultIsSanitized(
        result,
        secret,
        input.command,
        input.cwd,
        '/private/fixture/agent',
      )
    }
  })

  it('distinguishes ENOENT, non-ENOENT spawn errors, timeout, abort, and early exit', async () => {
    const missing = fixtureLaunch('ready-close')
    missing.input.command = join(tmpdir(), 'missing-private-runner')
    const missingResult = await probeSpawnedAgent(missing.input)
    assert.equal(missingResult.readiness.code, 'ACP_RUNNER_MISSING')
    assertPublicResultIsSanitized(missingResult, missing.input.command, missing.input.cwd)

    const invalidCwd = fixtureLaunch('ready-close')
    const cwdFile = join(tempDirs.at(-1)!, 'not-a-directory')
    writeFileSync(cwdFile, 'x')
    invalidCwd.input.cwd = cwdFile
    const spawnResult = await probeSpawnedAgent(invalidCwd.input)
    assert.equal(spawnResult.readiness.code, 'SPAWN_FAILED')
    assertPublicResultIsSanitized(spawnResult, cwdFile, invalidCwd.input.command)

    // Leave enough room for the tsx child loader to cold-start so this branch
    // verifies cleanup of a running ACP process, rather than cancellation while
    // Node is still bootstrapping the fixture.
    const timeout = fixtureLaunch('hang', { timeoutMs: 2_000 })
    const timeoutResult = await probeSpawnedAgent(timeout.input)
    assert.equal(timeoutResult.readiness.code, 'PROBE_TIMEOUT')
    assert.match(readTrace(timeout.traceFile), /:exit:0/)

    const abortController = new AbortController()
    const aborted = fixtureLaunch('hang', { signal: abortController.signal })
    const abortPending = probeSpawnedAgent(aborted.input)
    await waitForTrace(aborted.traceFile, /:fixture-ready/)
    abortController.abort()
    const abortResult = await abortPending
    assert.equal(abortResult.readiness.code, 'PROBE_ABORTED')
    assert.match(readTrace(aborted.traceFile), /:exit:0/)

    const early = fixtureLaunch('early-exit')
    const earlyResult = await probeSpawnedAgent(early.input)
    assert.equal(earlyResult.readiness.code, 'PROCESS_EXITED')
    assert.match(readTrace(early.traceFile), /:exit:17/)
  })

  it('does not call close/delete unless advertised and uses delete when it is advertised', async () => {
    const omitted = fixtureLaunch('ready-no-cleanup')
    assert.equal((await probeSpawnedAgent(omitted.input)).readiness.status, 'ready')
    assert.equal(/:session-(?:close|delete)/.test(readTrace(omitted.traceFile)), false)

    const advertised = fixtureLaunch('ready-delete')
    assert.equal((await probeSpawnedAgent(advertised.input)).readiness.status, 'ready')
    assert.match(readTrace(advertised.traceFile), /:session-delete/)
  })

  it('escalates cancellation after fixture readiness through SIGTERM to SIGKILL and confirms reap', async () => {
    const controller = new AbortController()
    const stubborn = fixtureLaunch('hang-ignore-term', {
      timeoutMs: 5_000,
      signal: controller.signal,
    })
    const pending = probeSpawnedAgent(stubborn.input)
    await waitForTrace(stubborn.traceFile, /:fixture-ready/)
    controller.abort()
    const result = await pending
    assert.equal(result.readiness.code, 'PROBE_ABORTED')
    const trace = readTrace(stubborn.traceFile)
    assert.match(trace, /:signal:SIGTERM:ignored/)
    if (process.platform !== 'win32') {
      const pid = Number(trace.split(':', 1)[0])
      assert.ok(Number.isInteger(pid) && pid > 0)
      assert.throws(() => process.kill(pid, 0))
    }
  })
})

describe('logoutSpawnedAgent', () => {
  it('calls logout only for an advertised empty-object capability and always reaps', async () => {
    const supported = fixtureLaunch('logout')
    const ok = await logoutSpawnedAgent(supported.input)
    assert.equal(ok.ok, true)
    assert.equal(ok.code, 'LOGOUT_SUCCEEDED')
    assert.match(readTrace(supported.traceFile), /:logout/)
    assert.match(readTrace(supported.traceFile), /:exit:0/)

    const unsupported = fixtureLaunch('logout-unsupported')
    const no = await logoutSpawnedAgent(unsupported.input)
    assert.equal(no.ok, false)
    assert.equal(no.code, 'LOGOUT_UNSUPPORTED')
    assert.equal(readTrace(unsupported.traceFile).includes(':logout'), false)
    assert.match(readTrace(unsupported.traceFile), /:exit:0/)
  })

  it('maps logout RPC failure without returning raw secrets and reaps', async () => {
    const { input, traceFile, secret } = fixtureLaunch('logout-fail')
    const result = await logoutSpawnedAgent(input)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'LOGOUT_FAILED')
    assertPublicResultIsSanitized(result, secret, input.command, input.cwd)
    assert.match(readTrace(traceFile), /:exit:0/)
  })

  it('classifies an early-exit logout child as PROCESS_EXITED', async () => {
    const early = fixtureLaunch('early-exit')
    const result = await logoutSpawnedAgent(early.input)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'PROCESS_EXITED')
    assert.match(readTrace(early.traceFile), /:exit:17/)
  })
})

describe('Windows spawned ACP process-tree cleanup', () => {
  class FakeWindowsChild extends EventEmitter {
    pid = 4321
    exitCode: number | null = null
    signalCode: NodeJS.Signals | null = null
    stdin = undefined
    stdout = undefined
    stderr = undefined
    directSignals: NodeJS.Signals[] = []

    kill(signal: NodeJS.Signals): boolean {
      this.directSignals.push(signal)
      return true
    }
  }

  it('terminates the complete live wrapper tree on normal probe completion', async () => {
    const child = new FakeWindowsChild()
    const calls: Array<{ file: string; args: string[]; options: unknown }> = []
    await terminateSpawnedProcessTreeForTests(child as never, {
      platform: 'win32',
      execFileImpl: (file, args, options, callback) => {
        calls.push({ file, args, options })
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit', 0, null))
        callback(null)
        return {} as never
      },
      terminateGraceMs: 5,
      killReapTimeoutMs: 50,
    })
    assert.deepEqual(calls, [
      {
        file: 'taskkill.exe',
        args: ['/PID', '4321', '/T'],
        options: { windowsHide: true, timeout: 50 },
      },
    ])
    assert.deepEqual(child.directSignals, [])
  })

  it('escalates a stubborn live wrapper tree to taskkill force on timeout cleanup', async () => {
    const child = new FakeWindowsChild()
    const calls: string[][] = []
    await terminateSpawnedProcessTreeForTests(child as never, {
      platform: 'win32',
      execFileImpl: (_file, args, _options, callback) => {
        calls.push(args)
        if (args.includes('/F')) {
          child.signalCode = 'SIGKILL'
          queueMicrotask(() => child.emit('exit', null, 'SIGKILL'))
        }
        callback(null)
        return {} as never
      },
      terminateGraceMs: 1,
      killReapTimeoutMs: 50,
    })
    assert.deepEqual(calls, [
      ['/PID', '4321', '/T'],
      ['/PID', '4321', '/T', '/F'],
    ])
    assert.deepEqual(child.directSignals, [])
  })

  it('still requests forced tree cleanup when the wrapper exited before teardown', async () => {
    const child = new FakeWindowsChild()
    child.exitCode = 17
    const calls: string[][] = []
    await terminateSpawnedProcessTreeForTests(child as never, {
      platform: 'win32',
      execFileImpl: (_file, args, _options, callback) => {
        calls.push(args)
        callback(null)
        return {} as never
      },
    })
    assert.deepEqual(calls, [['/PID', '4321', '/T', '/F']])
  })
})
