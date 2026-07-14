import { randomBytes, createHmac } from 'node:crypto'
import { resolve as pathResolve } from 'node:path'
import { realpathSync, rmSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { Writable, Readable } from 'node:stream'
import {
  client,
  ndJsonStream,
  methods,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ClientContext,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk'
import type { WorkerKind } from '@router-agents/shared'
import { extractModelOptions } from './acp-model-options.js'
import { readContainedText, writeContainedText } from './acp-filesystem.js'
import { prepareOpenCodeAcpEnv } from './opencode-acp-env.js'

// ── fingerprint & keys ──

function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals) {
  try { if (proc.pid) process.kill(-proc.pid, signal) }
  catch { try { proc.kill(signal) } catch {} }
}

let _hmacSecret: Buffer | null = null
function hmacSecret(): Buffer {
  if (!_hmacSecret) _hmacSecret = randomBytes(32)
  return _hmacSecret
}

export interface SessionEntryConfig {
  command: string; args: string[]; model?: string; env: Record<string, string>
}

export interface WorkerExecutionConfig {
  command: string
  args: string[]
  env?: Record<string, string>
  model?: string
  kind?: WorkerKind
  enabled?: boolean
}

const EXEC_FINGERPRINT_FIELDS: ReadonlyArray<keyof SessionEntryConfig> = ['command', 'args', 'model']

function normalizeEnvForFingerprint(env: Record<string, string>): string {
  return Object.keys(env)
    .sort()
    .map((k) => `${k}=${env[k] ?? ''}`)
    .join('|')
}

export function computeExecutionFingerprint(cfg: SessionEntryConfig): string {
  const parts = EXEC_FINGERPRINT_FIELDS.map((k) => {
    const v = cfg[k]; return Array.isArray(v) ? v.join('\x00') : v ?? ''
  })
  parts.push(normalizeEnvForFingerprint(cfg.env))
  return createHmac('sha256', hmacSecret()).update(parts.join('|')).digest('hex')
}

export function workerExecutionConfigChanged(
  before: WorkerExecutionConfig,
  after: WorkerExecutionConfig,
): boolean {
  return before.command !== after.command
    || before.model !== after.model
    || before.kind !== after.kind
    || before.enabled !== after.enabled
    || before.args.length !== after.args.length
    || before.args.some((arg, index) => arg !== after.args[index])
    || normalizeEnvForFingerprint(before.env ?? {}) !== normalizeEnvForFingerprint(after.env ?? {})
}

function canonicalizeCwd(raw: string): string {
  try { return realpathSync(pathResolve(raw)) } catch { return pathResolve(raw) }
}

export interface SessionReuseKey {
  routerSessionId: string; workerId: string; canonicalCwd: string; executionFingerprint: string
}

export function buildSessionReuseKey(params: {
  routerSessionId: string; workerId: string; cwd: string; config: SessionEntryConfig
}): SessionReuseKey {
  return {
    routerSessionId: params.routerSessionId, workerId: params.workerId,
    canonicalCwd: canonicalizeCwd(params.cwd),
    executionFingerprint: computeExecutionFingerprint(params.config),
  }
}

function reuseKeyToString(k: SessionReuseKey): string {
  return `${k.routerSessionId}::${k.workerId}::${k.canonicalCwd}::${k.executionFingerprint.slice(0, 12)}`
}

// ── prompt binding ──

export interface PromptBinding {
  jobId: string
  signal?: AbortSignal
  onPermissionRequest?: (req: { title: string; options: { optionId: string; name: string }[] }) => Promise<{ outcome: 'selected' | 'cancelled'; optionId?: string }>
  onOutputDelta?: (sequence: number, delta: string) => void
  sequence: number
}

// ── request / result ──

export interface EnqueuePromptRequest {
  key: SessionReuseKey; config: SessionEntryConfig; kind: WorkerKind
  task: string; binding: PromptBinding; signal?: AbortSignal
}

export interface EnqueuePromptResult {
  ok: boolean; output?: string; stopReason?: string; error?: string; modelUsed?: string; reusedSession: boolean
}

// ── live entry (internal) ──

const STDERR_MAX_BYTES = 8000

type EntryState = 'starting' | 'idle' | 'running' | 'closing' | 'closed' | 'broken'

interface LiveEntry {
  key: SessionReuseKey; state: EntryState; proc: ChildProcess
  session: ActiveSession; ctx: ClientContext; conn?: { agent: ClientContext; close: (err?: unknown) => void }  // conn holds the ClientConnection to keep transport alive

  createdAt: number; lastUsedAt: number; generation: number; summary: string
  currentBinding: PromptBinding | null
  promptQueue: QueueItem[]
  configOptions: SessionConfigOption[]
  _sigkillScheduled?: boolean
  _closing?: boolean
  isolatedHome?: string
}

interface QueueItem {
  task: string
  binding: PromptBinding
  resolve: (r: EnqueuePromptResult) => void
  reject: (e: unknown) => void
  abortCleanup?: () => void
}

// ── manager ──

export interface AcpSessionManagerConfig {
  idleTimeoutMs?: number; poolMax?: number
  onActivity?: (event: string, meta?: Record<string, unknown>) => void
}

function positiveEnvInt(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export class AcpSessionManager {
  private entries = new Map<string, LiveEntry>()
  private idleTimeoutMs: number
  private poolMax: number
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private reuseEnabled: boolean
  private sessionToProject = new Map<string, string>()
  private onActivity?: (event: string, meta?: Record<string, unknown>) => void

  constructor(cfg: AcpSessionManagerConfig = {}) {
    this.idleTimeoutMs = cfg.idleTimeoutMs ?? positiveEnvInt('ACP_SESSION_IDLE_MS', 900_000)
    this.poolMax = cfg.poolMax ?? positiveEnvInt('ACP_SESSION_POOL_MAX', 8)
    this.reuseEnabled = process.env.ACP_SESSION_REUSE !== '0'
    this.onActivity = cfg.onActivity
    this.idleTimer = setInterval(() => this.reapIdle(), 30_000)
    if (this.idleTimer.unref) this.idleTimer.unref()
  }

  setSessionProject(routerSessionId: string, projectId: string): void {
    this.sessionToProject.set(routerSessionId, projectId)
  }

  canAccept(key: SessionReuseKey): boolean {
    const existing = this.entries.get(reuseKeyToString(key))
    if (existing) return true
    if (this.entries.size < this.poolMax) return true
    this.evictLRU()
    return this.entries.size < this.poolMax
  }

  willReuse(key: SessionReuseKey): boolean {
    if (!this.reuseEnabled) return false
    const entry = this.entries.get(reuseKeyToString(key))
    return Boolean(entry && (entry.state === 'starting' || entry.state === 'idle' || entry.state === 'running'))
  }

  private queuePrompt(entry: LiveEntry, req: EnqueuePromptRequest): Promise<EnqueuePromptResult> {
    return new Promise((resolve, reject) => {
      const item: QueueItem = { task: req.task, binding: req.binding, resolve, reject }
      entry.promptQueue.push(item)
      const signal = req.binding.signal
      if (!signal) return

      const onAbort = () => {
        const idx = entry.promptQueue.indexOf(item)
        if (idx < 0) return
        entry.promptQueue.splice(idx, 1)
        item.abortCleanup?.()
        reject(new Error('Cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      item.abortCleanup = () => signal.removeEventListener('abort', onAbort)
      if (signal.aborted) onAbort()
    })
  }

  private rejectQueued(entry: LiveEntry, error: Error): void {
    while (entry.promptQueue.length > 0) {
      const item = entry.promptQueue.shift()!
      item.abortCleanup?.()
      item.reject(error)
    }
  }

  async enqueuePrompt(req: EnqueuePromptRequest): Promise<EnqueuePromptResult> {
    if (this.closed) return { ok: false, error: 'Session manager closed', reusedSession: false }
    if (req.binding.signal?.aborted) return { ok: false, error: 'Cancelled', reusedSession: false }
    if (!this.reuseEnabled) {
      const keyStr = reuseKeyToString(req.key)
      let entry = this.entries.get(keyStr)
      if (entry) {
        if (entry.state === 'broken' || entry.state === 'closing' || entry.state === 'closed') {
          this.entries.delete(keyStr); entry = undefined
        } else if (entry.state === 'running' || entry.state === 'starting' || entry.currentBinding) {
          // The scheduler retries after the active prompt finishes, at which
          // point this entry is closed and a fresh ACP session is created.
          return { ok: false, error: 'capacity_exhausted', reusedSession: false }
        } else {
          this.entries.delete(keyStr)
          this.closeEntry(entry)
        }
      }
      return this.createAndExecute(req)
    }
    const keyStr = reuseKeyToString(req.key)
    let entry = this.entries.get(keyStr)
    if (entry && (entry.state === 'broken' || entry.state === 'closing' || entry.state === 'closed')) {
      this.entries.delete(keyStr); entry = undefined
    }
    if (entry) {
      if (entry.state === 'running' || entry.state === 'starting' || entry.currentBinding) {
        return this.queuePrompt(entry, req)
      }
      this.onActivity?.('session_reused', { summary: entry.summary, workerId: entry.key.workerId, routerSessionId: entry.key.routerSessionId })
      return this.executePrompt(entry, req.task, req.binding, true)
    }
    if (this.entries.size >= this.poolMax) {
      this.evictLRU()
      if (this.entries.size >= this.poolMax) {
        return { ok: false, error: 'capacity_exhausted', reusedSession: false }
      }
    }
    return this.createAndExecute(req)
  }

  private async createAndExecute(req: EnqueuePromptRequest): Promise<EnqueuePromptResult> {
    const { key, config, kind, task, binding } = req
    let command: string; let args: string[]; let env: Record<string, string>
    let isolatedHome: string | undefined
    if (kind === 'opencode') {
      const prep = prepareOpenCodeAcpEnv({
        baseEnv: { ...process.env, ...config.env } as NodeJS.ProcessEnv,
        model: config.model ?? undefined,
      })
      command = config.command; args = config.args?.length ? [...config.args] : ['acp']
      env = prep.env as Record<string, string>
      isolatedHome = prep.isolatedHome
    } else {
      command = config.command; args = [...config.args]; env = { ...config.env }
    }

    const proc = spawn(command, args, {
      cwd: key.canonicalCwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    })

    const stderrChunks: string[] = []
    proc.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8')
      if (stderrChunks.join('').length < STDERR_MAX_BYTES)
        stderrChunks.push(s.slice(0, STDERR_MAX_BYTES - stderrChunks.join('').length))
    })

    const keyStr = reuseKeyToString(key)
    const entry: LiveEntry = {
      key, state: 'starting', proc,
      session: undefined!, ctx: undefined!,
      createdAt: Date.now(), lastUsedAt: Date.now(), generation: 1,
      summary: `w=${key.workerId} s=${key.routerSessionId.slice(0, 8)} gen=1`,
      currentBinding: null, promptQueue: [], configOptions: [],
      isolatedHome,
    }
    this.entries.set(keyStr, entry)

    proc.on('exit', () => { this.evictEntry(keyStr, entry) })
    proc.on('error', () => { this.evictEntry(keyStr, entry) })

    try {
      const input = Writable.toWeb(proc.stdin!)
      const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>
      const stream = ndJsonStream(input, output)

      const app = client({ name: `pool-${key.workerId}` })
        .onRequest(methods.client.session.requestPermission, async (ctx) => {
          const b = entry.currentBinding
          if (!b?.onPermissionRequest) return { outcome: { outcome: 'cancelled' as const } }
          const r = await b.onPermissionRequest({
            title: ctx.params.toolCall.title ?? 'Permission required',
            options: (ctx.params.options ?? []).map((o) => ({ optionId: o.optionId ?? '', name: o.name ?? '' })),
          })
          if (r.outcome === 'cancelled' || !r.optionId) return { outcome: { outcome: 'cancelled' as const } }
          return { outcome: { outcome: 'selected' as const, optionId: r.optionId } }
        })
        .onRequest(methods.client.fs.readTextFile, async (ctx) => {
          const r = readContainedText(key.canonicalCwd, ctx.params.path)
          if (!r.ok) throw new Error(r.error)
          return { content: r.content }
        })
        .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
          const r = writeContainedText(key.canonicalCwd, ctx.params.path, ctx.params.content)
          if (!r.ok) throw new Error(r.error)
          return {}
        })

      // Use connect() instead of connectWith() to keep transport alive for session reuse
      const conn = app.connect(stream) as { agent: ClientContext; close: (err?: unknown) => void }
      entry.conn = conn

      await conn.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      })
      const session = await conn.agent.buildSession(key.canonicalCwd).start()
      entry.session = session; entry.ctx = conn.agent
      entry.configOptions = session.newSessionResponse.configOptions ?? []
      entry.state = 'idle'; entry.lastUsedAt = Date.now()
      this.onActivity?.('session_created', { summary: entry.summary, workerId: key.workerId, routerSessionId: key.routerSessionId })

      // Set model config option if configured
      const modelOpts = extractModelOptions(session.newSessionResponse.configOptions ?? [])
      const effectiveModel = config.model?.trim()
      if (effectiveModel) {
        const valid = modelOpts.models.find((m) => m.modelId === effectiveModel)
        if (!valid) throw new Error(`Model "${effectiveModel}" not in agent config options`)
        const modelOptId = entry.configOptions.find((o) =>
          o.type === 'select' && 'options' in o && Array.isArray(o.options) &&
          o.options.some((ov) => {
            if ('group' in ov) return ov.options.some((s) => s.value === effectiveModel)
            return 'value' in ov && ov.value === effectiveModel
          })
        )?.id ?? ''
        if (modelOptId) {
          await conn.agent.request(methods.agent.session.setConfigOption, {
            sessionId: session.sessionId, configId: modelOptId, value: effectiveModel,
          })
        }
      }

      return this.executePrompt(entry, task, binding, false)
    } catch (e) {
      this.failEntry(keyStr, entry, e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  private async executePrompt(
    entry: LiveEntry, task: string, binding: PromptBinding, reusedSession: boolean,
  ): Promise<EnqueuePromptResult> {
    const keyStr = reuseKeyToString(entry.key)
    entry.state = 'running'; entry.currentBinding = binding; entry.lastUsedAt = Date.now()
    let onAbort: (() => void) | undefined
    try {
      if (binding.signal?.aborted) {
        entry.currentBinding = null
        this.evictEntry(keyStr, entry)
        return { ok: false, error: 'Cancelled', reusedSession }
      }
      if (binding.signal) {
        onAbort = () => {
          try { entry.ctx?.notify(methods.agent.session.cancel, { sessionId: entry.session?.sessionId }).catch(() => {}) } catch {}
          setTimeout(() => {
            if (entry.currentBinding === binding) this.evictEntry(keyStr, entry)
          }, 2000)
        }
        binding.signal.addEventListener('abort', onAbort, { once: true })
        if (binding.signal.aborted) {
          binding.signal.removeEventListener('abort', onAbort)
          entry.currentBinding = null
          this.evictEntry(keyStr, entry)
          return { ok: false, error: 'Cancelled', reusedSession }
        }
      }

      void entry.session.prompt(task)
      let output = ''
      for (;;) {
        const msg = await entry.session.nextUpdate()
        if (msg.kind === 'stop') {
          const ok = msg.stopReason === 'end_turn'
          if (onAbort && binding.signal) binding.signal.removeEventListener('abort', onAbort)
          // User cancel → evict session per spec §6
          if (msg.stopReason === 'cancelled') {
            this.evictEntry(keyStr, entry)
            return { ok: false, output, stopReason: msg.stopReason, error: 'Cancelled', modelUsed: undefined, reusedSession }
          }
          entry.currentBinding = null
          if (entry._closing) {
            this.evictEntry(keyStr, entry)
            return { ok, output, stopReason: msg.stopReason, error: ok ? undefined : `Agent stopped: ${msg.stopReason}`, modelUsed: undefined, reusedSession }
          }
          entry.state = 'idle'; entry.lastUsedAt = Date.now()
          this.drainQueue(entry)
          if (!this.reuseEnabled && entry.state === 'idle') this.evictEntry(keyStr, entry)
          return { ok, output, stopReason: msg.stopReason, error: ok ? undefined : `Agent stopped: ${msg.stopReason}`, modelUsed: undefined, reusedSession }
        }
        if (msg.kind === 'session_update' && msg.update.sessionUpdate === 'agent_message_chunk' && msg.update.content?.type === 'text') {
          const text = String(msg.update.content.text)
          output += text
          binding.sequence++
          binding.onOutputDelta?.(binding.sequence, text)
        }
      }
    } catch (e) {
      if (onAbort && binding.signal) binding.signal.removeEventListener('abort', onAbort)
      entry.currentBinding = null; entry.state = 'broken'
      this.evictEntry(keyStr, entry)
      return { ok: false, error: e instanceof Error ? e.message : String(e), reusedSession }
    }
  }

  private drainQueue(entry: LiveEntry): void {
    const next = entry.promptQueue.shift()
    if (next) {
      next.abortCleanup?.()
      void this.executePrompt(entry, next.task, next.binding, true).then(next.resolve, next.reject)
    }
  }

  closeByRouterSession(routerSessionId: string): void {
    const toClose: LiveEntry[] = []
    for (const [k, e] of this.entries) { if (e.key.routerSessionId === routerSessionId) { toClose.push(e); this.entries.delete(k) } }
    for (const e of toClose) {
      this.rejectQueued(e, new Error('ACP session closed by router session'))
      this.closeEntry(e)
    }
  }

  closeByProject(projectId: string): void {
    const toClose: LiveEntry[] = []
    for (const [k, e] of this.entries) {
      if (this.sessionToProject.get(e.key.routerSessionId) === projectId) { toClose.push(e); this.entries.delete(k) }
    }
    for (const e of toClose) {
      this.rejectQueued(e, new Error('Project closed'))
      this.closeEntry(e)
    }
  }

  invalidateWorker(workerId: string): void {
    for (const [k, e] of this.entries) {
      if (e.key.workerId === workerId) {
        this.onActivity?.('session_invalidated', { summary: e.summary, workerId: e.key.workerId, routerSessionId: e.key.routerSessionId, state: e.state })
        if (e.state === 'idle') { this.entries.delete(k); this.closeEntry(e) }
        else { e._closing = true; e.state = 'closing' }
      }
    }
  }

  async closeAll(): Promise<void> {
    this.closed = true
    if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null }
    for (const e of this.entries.values()) {
      if (e.currentBinding) {
        try { e.ctx?.notify(methods.agent.session.cancel, { sessionId: e.session?.sessionId }).catch(() => {}) } catch {}
      }
    }
    await new Promise((r) => setTimeout(r, 2000))
    const all = [...this.entries.values()]; this.entries.clear()
    for (const e of all) {
      this.rejectQueued(e, new Error('ACP session manager closed'))
      this.closeEntry(e)
    }
  }

  getDebugInfo() {
    const byState: Record<string, number> = {}; let entries = 0
    for (const e of this.entries.values()) { entries++; byState[e.state] = (byState[e.state] ?? 0) + 1 }
    return { entries, entriesByState: byState }
  }

  private evictEntry(keyStr: string, entry: LiveEntry): void {
    if (this.entries.get(keyStr) === entry) this.entries.delete(keyStr)
    this.onActivity?.('session_evicted', { summary: entry.summary, workerId: entry.key.workerId, routerSessionId: entry.key.routerSessionId, state: entry.state })
    this.rejectQueued(entry, new Error('ACP session evicted'))
    this.closeEntry(entry)
  }

  private failEntry(keyStr: string, entry: LiveEntry, reason: string): void {
    this.entries.delete(keyStr); entry.state = 'broken'
    this.onActivity?.('session_broken', { summary: entry.summary, workerId: entry.key.workerId, routerSessionId: entry.key.routerSessionId, reason })
    this.rejectQueued(entry, new Error(`ACP session ${reason}`))
    this.closeEntry(entry)
  }

  private closeEntry(entry: LiveEntry): void {
    this.onActivity?.('session_closed', { summary: entry.summary, workerId: entry.key.workerId, routerSessionId: entry.key.routerSessionId, state: entry.state })
    try { (entry.conn as any)?.close?.() } catch {}
    try { entry.session?.dispose() } catch {}
    if (entry.isolatedHome) {
      try { rmSync(entry.isolatedHome, { recursive: true, force: true }) } catch {}
    }
    if (entry.proc && entry.proc.exitCode === null && entry.proc.signalCode === null) {
      try { killProcessGroup(entry.proc, 'SIGTERM') } catch {}
      if (!entry._sigkillScheduled) {
        entry._sigkillScheduled = true
        setTimeout(() => {
          if (entry.proc && entry.proc.exitCode === null && entry.proc.signalCode === null) {
            try { killProcessGroup(entry.proc, 'SIGKILL') } catch {}
          }
        }, 2000)
      }
    }
  }

  private evictLRU(): void {
    let oldest: [string, LiveEntry] | null = null
    for (const [k, e] of this.entries) {
      if (e.state !== 'idle') continue
      if (!oldest || e.lastUsedAt < oldest[1].lastUsedAt) oldest = [k, e]
    }
    if (oldest) { this.entries.delete(oldest[0]); this.closeEntry(oldest[1]) }
  }

  private reapIdle(): void {
    const cutoff = Date.now() - this.idleTimeoutMs
    const toClose: Array<[string, LiveEntry]> = []
    for (const [k, e] of this.entries) { if (e.state === 'idle' && e.lastUsedAt < cutoff) toClose.push([k, e]) }
    for (const [k, e] of toClose) { this.entries.delete(k); this.closeEntry(e) }
  }
}

let _singleton: AcpSessionManager | null = null

export function getAcpSessionManager(cfg?: AcpSessionManagerConfig): AcpSessionManager {
  if (!_singleton) _singleton = new AcpSessionManager(cfg)
  return _singleton
}

export function resetAcpSessionManager(): void {
  if (_singleton) { _singleton.closeAll().catch(() => {}); _singleton = null }
}
