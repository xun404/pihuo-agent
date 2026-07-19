import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import type { WorkerKind } from '@swarmdesk-agent/shared'
import { AcpSessionDriver } from './acp-session-driver.js'
import type { AcpSessionCatalogRecord } from './acp-session-catalog-port.js'
import { prepareOpenCodeAcpEnv } from './opencode-acp-env.js'
import { buildEffectiveWorkerEnv } from './worker-env.js'

export interface AcpRemoteCleanupConfig {
  command: string
  args: string[]
  env: Record<string, string>
  kind: WorkerKind
  timeoutMs?: number
}

const DEFAULT_REMOTE_CLEANUP_TIMEOUT_MS = 5_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

export function resolveRemoteCleanupTimeoutMs(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REMOTE_CLEANUP_TIMEOUT_MS
  return Math.min(Math.max(1, Math.floor(parsed)), MAX_TIMER_DELAY_MS)
}

function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (proc.pid) process.kill(-proc.pid, signal)
  } catch {
    try {
      proc.kill(signal)
    } catch {}
  }
}

/**
 * Opens a short-lived ACP connection solely to delete/close an existing remote
 * session. The caller owns logging and must never expose the record identity.
 */
export async function cleanupRemoteAcpSession(
  record: AcpSessionCatalogRecord,
  config: AcpRemoteCleanupConfig,
): Promise<void> {
  const timeoutMs = resolveRemoteCleanupTimeoutMs(config.timeoutMs)
  let command = config.command
  let args = [...config.args]
  let env = buildEffectiveWorkerEnv({
    ambientEnv: process.env,
    workerEnv: config.env,
  })
  let isolatedHome: string | undefined

  if (config.kind === 'opencode') {
    const prepared = prepareOpenCodeAcpEnv({ baseEnv: env })
    command = config.command
    args = args.length > 0 ? args : ['acp']
    env = prepared.env as Record<string, string>
    isolatedHome = prepared.isolatedHome
  }

  let proc: ChildProcess
  try {
    proc = spawn(command, args, {
      cwd: record.canonicalCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })
  } catch (error) {
    if (isolatedHome) {
      try {
        rmSync(isolatedHome, { recursive: true, force: true })
      } catch {}
    }
    throw error
  }
  const spawnFailure = new Promise<never>((_resolve, reject) => {
    proc.once('error', reject)
  })
  proc.stderr?.on('data', () => {
    // Drain diagnostics so cleanup cannot deadlock on a full stderr pipe.
  })
  let driver: AcpSessionDriver | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    const operation = (async () => {
      driver = await AcpSessionDriver.fromChildProcess(
        record.canonicalCwd,
        Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
      )
      await driver.initialize()

      if (driver.hasCapability('delete')) {
        await driver.deleteSession(record.agentSessionId)
        return
      }
      if (!driver.hasCapability('close')) return

      if (driver.hasCapability('resume')) {
        await driver.sessionResume(record.agentSessionId)
      } else if (driver.hasCapability('load')) {
        await driver.sessionLoad(record.agentSessionId)
      } else {
        return
      }
      await driver.closeSession(record.agentSessionId)
    })()

    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        killProcessGroup(proc, 'SIGTERM')
        reject(new Error('remote_cleanup_timeout'))
      }, timeoutMs)
      timeout.unref?.()
    })
    await Promise.race([operation, deadline, spawnFailure])
  } finally {
    if (timeout) clearTimeout(timeout)
    try {
      driver?.close()
    } catch {}
    if (proc.exitCode === null && proc.signalCode === null) {
      killProcessGroup(proc, 'SIGTERM')
    }
    // Detached grandchildren may survive after the direct child exits.
    const killTimer = setTimeout(() => killProcessGroup(proc, 'SIGKILL'), 2_000)
    killTimer.unref?.()
    if (isolatedHome) {
      try {
        rmSync(isolatedHome, { recursive: true, force: true })
      } catch {}
    }
  }
}
