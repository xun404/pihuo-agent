import { execFile, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_SMOKE_AGENTS = 5
export const DEFAULT_SMOKE_TIMEOUT_MS = 300_000
export const MAX_SMOKE_TIMEOUT_MS = 600_000

const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/iu
const DISTRIBUTIONS = new Set(['npx', 'uvx', 'binary'])
const SAFE_INHERITED_ENV = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'LANG',
  'LC_ALL',
  'TZ',
]
const MAX_CAPTURE_BYTES = 64 * 1024
const TSX_LOADER_URL = import.meta.resolve('tsx')
const PRODUCTION_RUNNER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'acp-registry-smoke-runner.ts',
)

export class SmokeUsageError extends Error {
  constructor(message, exitCode = 2) {
    super(message)
    this.name = 'SmokeUsageError'
    this.exitCode = exitCode
  }
}

function optionValue(args, name) {
  const exact = args.indexOf(name)
  if (exact >= 0) return args[exact + 1]
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function parseSelection(value) {
  const separator = value.lastIndexOf(':')
  const registryId = (separator >= 0 ? value.slice(0, separator) : value).trim()
  const distribution = separator >= 0 ? value.slice(separator + 1).trim() : undefined
  if (!AGENT_ID.test(registryId)) {
    throw new SmokeUsageError('Invalid agent id in --agents allowlist')
  }
  if (distribution !== undefined && !DISTRIBUTIONS.has(distribution)) {
    throw new SmokeUsageError('Invalid distribution; expected npx, uvx, or binary')
  }
  return {
    registryId,
    ...(distribution ? { distribution } : {}),
  }
}

export function parseSmokeArgs(args) {
  const confirmed = args.includes('--confirm-third-party-execution')
  const rawAgents = optionValue(args, '--agents')
  if (!confirmed) {
    throw new SmokeUsageError(
      'Refused: pass --confirm-third-party-execution and --agents <id[:distribution],...>',
    )
  }
  if (!rawAgents || rawAgents.startsWith('--')) {
    throw new SmokeUsageError('--agents allowlist is required')
  }
  const rawSelections = rawAgents
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (rawSelections.length === 0) throw new SmokeUsageError('--agents allowlist is required')
  if (rawSelections.length > MAX_SMOKE_AGENTS) {
    throw new SmokeUsageError(`Select at most ${MAX_SMOKE_AGENTS} agents per smoke run`)
  }
  const agents = rawSelections.map(parseSelection)
  const unique = new Set(agents.map((entry) => entry.registryId))
  if (unique.size !== agents.length) {
    throw new SmokeUsageError('Duplicate agent ids are not allowed')
  }

  const rawTimeout = optionValue(args, '--timeout-ms')
  let timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS
  if (rawTimeout !== undefined) {
    const parsed = Number(rawTimeout)
    if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > MAX_SMOKE_TIMEOUT_MS) {
      throw new SmokeUsageError(
        `--timeout-ms must be an integer from 1000 to ${MAX_SMOKE_TIMEOUT_MS}`,
      )
    }
    timeoutMs = parsed
  }

  const knownFlags = new Set([
    '--confirm-third-party-execution',
    '--allow-unverified-binary',
    '--json',
  ])
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (knownFlags.has(arg)) continue
    if (arg === '--agents' || arg === '--timeout-ms') {
      i += 1
      continue
    }
    if (arg.startsWith('--agents=') || arg.startsWith('--timeout-ms=')) continue
    throw new SmokeUsageError(`Unknown smoke option: ${arg.slice(0, 80)}`)
  }

  return {
    confirmed: true,
    agents,
    timeoutMs,
    json: args.includes('--json'),
    allowUnverifiedBinary: args.includes('--allow-unverified-binary'),
  }
}

export function createSmokeIsolation(sourceEnv = process.env) {
  const root = mkdtempSync(join(tmpdir(), 'ra-acp-smoke-'))
  const paths = {
    home: join(root, 'home'),
    data: join(root, 'router-data'),
    cwd: join(root, 'cwd'),
    xdgCache: join(root, 'xdg-cache'),
    xdgConfig: join(root, 'xdg-config'),
    xdgData: join(root, 'xdg-data'),
    xdgState: join(root, 'xdg-state'),
    xdgRuntime: join(root, 'xdg-runtime'),
    npmCache: join(root, 'npm-cache'),
    uvCache: join(root, 'uv-cache'),
    pipCache: join(root, 'pip-cache'),
    temp: join(root, 'tmp'),
  }
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true, mode: 0o700 })

  const env = {}
  for (const key of SAFE_INHERITED_ENV) {
    if (typeof sourceEnv[key] === 'string' && sourceEnv[key]) env[key] = sourceEnv[key]
  }
  Object.assign(env, {
    HOME: paths.home,
    USERPROFILE: paths.home,
    ROUTER_DATA_DIR: paths.data,
    ROUTER_AGENTS_DIR: paths.data,
    ROUTER_RUNTIME_ROLE: 'owner',
    ROUTER_CLIENT_ONLY: '0',
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_DATA_HOME: paths.xdgData,
    XDG_STATE_HOME: paths.xdgState,
    XDG_RUNTIME_DIR: paths.xdgRuntime,
    npm_config_cache: paths.npmCache,
    NPM_CONFIG_CACHE: paths.npmCache,
    UV_CACHE_DIR: paths.uvCache,
    PIP_CACHE_DIR: paths.pipCache,
    TMPDIR: paths.temp,
    TEMP: paths.temp,
    TMP: paths.temp,
    CI: '1',
    NO_COLOR: '1',
    npm_config_yes: 'true',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  })

  let cleaned = false
  return {
    root,
    cwd: paths.cwd,
    env,
    cleanup() {
      if (cleaned) return
      cleaned = true
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    },
  }
}

function spawnProductionRunner(input) {
  return spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    detached: true,
    windowsHide: true,
  })
}

function appendBounded(chunks, chunk, state) {
  if (state.bytes >= MAX_CAPTURE_BYTES) {
    state.overflow = true
    return
  }
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
  const remaining = MAX_CAPTURE_BYTES - state.bytes
  chunks.push(buffer.subarray(0, remaining))
  state.bytes += Math.min(buffer.length, remaining)
  if (buffer.length > remaining) state.overflow = true
}

function directKill(child) {
  try {
    child.kill('SIGKILL')
  } catch {}
}

export function forceKillTree(
  child,
  { platform = process.platform, execFileImpl = execFile } = {},
) {
  if (platform === 'win32' && child.pid) {
    try {
      execFileImpl(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true },
        (error) => {
          if (error) directKill(child)
        },
      )
      return
    } catch {
      directKill(child)
      return
    }
  }
  try {
    if (child.pid) {
      process.kill(-child.pid, 'SIGKILL')
      return
    }
  } catch {
    // Fall back to the direct child handle.
  }
  directKill(child)
}

function failureReport(options, code) {
  return {
    ok: false,
    results: options.agents.map((entry) => ({
      registryId: entry.registryId,
      ...(entry.distribution ? { distribution: entry.distribution } : {}),
      status: 'upstream_failed',
      code,
    })),
  }
}

function parseRunnerReport(raw, options, overflow) {
  if (overflow || Buffer.byteLength(raw, 'utf8') > MAX_CAPTURE_BYTES) {
    return failureReport(options, 'SMOKE_OUTPUT_LIMIT')
  }
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !Array.isArray(value.results)) {
      return failureReport(options, 'SMOKE_RUNNER_FAILED')
    }
    return value
  } catch {
    return failureReport(options, 'SMOKE_RUNNER_FAILED')
  }
}

/**
 * Runs the isolated TS runner. Tests inject an inert child; production uses the
 * real product-path runner. No child diagnostics are returned or printed.
 */
export async function runSmokeController(input) {
  const {
    options,
    isolation,
    spawnRunner = spawnProductionRunner,
    gracefulShutdownMs = 70_000,
    runnerPath = PRODUCTION_RUNNER_PATH,
    signal,
  } = input
  const request = Buffer.from(
    JSON.stringify({
      confirmed: true,
      selections: options.agents,
      allowUnverifiedBinary: options.allowUnverifiedBinary,
    }),
  ).toString('base64url')
  let child
  try {
    child = spawnRunner({
      command: process.execPath,
      args: ['--import', TSX_LOADER_URL, runnerPath, '--request-base64', request],
      cwd: isolation.cwd,
      env: isolation.env,
    })
  } catch (error) {
    isolation.cleanup()
    throw error
  }
  const stdout = []
  const stderr = []
  const stdoutState = { bytes: 0, overflow: false }
  const stderrState = { bytes: 0, overflow: false }
  child.stdout?.on('data', (chunk) => appendBounded(stdout, chunk, stdoutState))
  child.stderr?.on('data', (chunk) => appendBounded(stderr, chunk, stderrState))

  let desiredExitCode = null
  let shutdownReason = null
  let forceTimer
  let totalTimer
  let abortCleanup
  const requestShutdown = (reason, exitCode) => {
    if (shutdownReason) return
    shutdownReason = reason
    desiredExitCode = exitCode
    try {
      child.send?.({ type: 'shutdown', reason })
    } catch {}
    forceTimer = setTimeout(() => forceKillTree(child), gracefulShutdownMs)
    forceTimer.unref?.()
  }

  totalTimer = setTimeout(() => requestShutdown('total_timeout', 124), options.timeoutMs)
  totalTimer.unref?.()
  if (signal) {
    const onAbort = () => requestShutdown('interrupted', 130)
    signal.addEventListener('abort', onAbort, { once: true })
    abortCleanup = () => signal.removeEventListener('abort', onAbort)
    if (signal.aborted) onAbort()
  }

  try {
    const childExitCode = await new Promise((resolve) => {
      let settled = false
      const finish = (code) => {
        if (settled) return
        settled = true
        resolve(typeof code === 'number' ? code : 1)
      }
      child.once('error', () => finish(1))
      child.once('exit', (code) => finish(code))
    })
    if (shutdownReason === 'total_timeout') {
      return {
        exitCode: 124,
        report: failureReport(options, 'SMOKE_TOTAL_TIMEOUT'),
      }
    }
    if (shutdownReason === 'interrupted') {
      return {
        exitCode: desiredExitCode ?? 130,
        report: failureReport(options, 'SMOKE_INTERRUPTED'),
      }
    }
    const report = parseRunnerReport(
      Buffer.concat(stdout).toString('utf8'),
      options,
      stdoutState.overflow,
    )
    return {
      exitCode: childExitCode === 0 && report.ok === true ? 0 : 1,
      report,
    }
  } finally {
    if (totalTimer) clearTimeout(totalTimer)
    if (forceTimer) clearTimeout(forceTimer)
    abortCleanup?.()
    child.stdout?.removeAllListeners?.()
    child.stderr?.removeAllListeners?.()
    isolation.cleanup()
  }
}
