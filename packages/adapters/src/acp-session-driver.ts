import {
  client,
  ndJsonStream,
  methods,
  PROTOCOL_VERSION,
  type ClientApp,
  type ClientConnection,
  type ClientContext,
  type SessionConfigOption,
  type AgentCapabilities,
  type InitializeResponse,
  type NewSessionResponse,
  type LoadSessionResponse,
  type ResumeSessionResponse,
  type PromptResponse,
  type Stream,
  type AuthMethod,
  type ClientCapabilities,
} from '@agentclientprotocol/sdk'
import { readContainedText, writeContainedText } from './acp-filesystem.js'
import {
  InvalidAcpApprovalOptionsError,
  type AcpPermissionRequest,
  mapPermissionRequest,
} from './acp-session.js'

export type SessionDisposition = 'new' | 'resume' | 'load'

/** Normalized ACP stop reasons (design §11). */
export type NormalizedStopReason =
  'end_turn' | 'cancelled' | 'refusal' | 'max_tokens' | 'max_turn_requests' | 'unknown'

export function normalizeStopReason(raw: unknown): NormalizedStopReason {
  const s = typeof raw === 'string' ? raw : ''
  switch (s) {
    case 'end_turn':
    case 'cancelled':
    case 'refusal':
    case 'max_tokens':
    case 'max_turn_requests':
      return s
    default:
      return s ? 'unknown' : 'unknown'
  }
}

function stopReasonPublicError(stopReason: NormalizedStopReason): string {
  switch (stopReason) {
    case 'refusal':
      return 'Agent refused the request'
    case 'max_tokens':
      return 'Agent stopped: max tokens'
    case 'max_turn_requests':
      return 'Agent stopped: max turn requests'
    case 'cancelled':
      return 'Cancelled'
    case 'unknown':
      return 'Agent stopped with unknown reason'
    default:
      return `Agent stopped: ${stopReason}`
  }
}

export interface OnSessionReadyResult {
  disposition: SessionDisposition
  agentSessionId: string
  capabilities: AgentCapabilities
  configOptions: SessionConfigOption[]
}

export type AcpRuntimeErrorCode =
  | 'recovery_not_supported'
  | 'session_not_found'
  | 'recovery_failed'
  | 'model_configuration_failed'
  | 'catalog_repair_required'
  | 'acp_runtime_not_configured'
  | 'invalid_approval_options'
  | 'protocol_incompatible'
  | 'auth_required'
  | 'auth_failed'

export interface AcpRecoveryError {
  code: Extract<
    AcpRuntimeErrorCode,
    'recovery_not_supported' | 'session_not_found' | 'recovery_failed'
  >
  publicMessage: string
  canResetAcpContext: boolean
}

export class AcpSessionRuntimeError extends Error {
  constructor(
    readonly code: AcpRuntimeErrorCode,
    readonly publicMessage: string,
    readonly canResetAcpContext: boolean,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options)
    this.name = 'AcpSessionRuntimeError'
  }
}

export function isAcpSessionRuntimeError(value: unknown): value is AcpSessionRuntimeError {
  return value instanceof AcpSessionRuntimeError
}

export interface PromptBinding {
  jobId: string
  signal?: AbortSignal
  onPermissionRequest?: (
    req: AcpPermissionRequest,
  ) => Promise<{ outcome: 'selected' | 'cancelled'; optionId?: string }>
  onOutputDelta?: (sequence: number, delta: string) => void
  onSessionReady?: (disposition: string) => void
  sequence: number
}

export interface PromptResult {
  ok: boolean
  output: string
  stopReason?: string
  error?: string
}

export interface InitializeDriverOptions {
  /**
   * When true, advertise clientCapabilities.auth.terminal.
   * Only set once Owner confirms node-pty / terminal auth is ready.
   */
  terminalAuth?: boolean
  clientName?: string
  clientVersion?: string
}

export class AcpSessionDriver {
  private app: ClientApp
  private conn!: ClientConnection
  private agent!: ClientContext
  private initResponse: InitializeResponse | null = null
  private _agentSessionId: string | null = null
  private _configOptions: SessionConfigOption[] = []
  private _capabilities: AgentCapabilities = {}
  private _authMethods: AuthMethod[] = []
  private _agentInfo: InitializeResponse['agentInfo'] = null
  private currentBinding: PromptBinding | null = null
  private isLoadPhase = false
  private _cwd: string
  private _outputAcc: string = ''
  private permissionError: AcpSessionRuntimeError | null = null

  private constructor(app: ClientApp, cwd: string) {
    this.app = app
    this._cwd = cwd
  }

  static async connect(cwd: string, transportStream: Stream): Promise<AcpSessionDriver> {
    const app = client({ name: 'pool-session' })
    const drv = new AcpSessionDriver(app, cwd)

    app
      .onRequest(methods.client.session.requestPermission, async (ctx) => {
        const notifSid = (ctx.params as Record<string, unknown>)?.sessionId
        if (notifSid && notifSid !== drv._agentSessionId) {
          return { outcome: { outcome: 'cancelled' as const } }
        }
        const b = drv.currentBinding
        if (!b?.onPermissionRequest) return { outcome: { outcome: 'cancelled' as const } }
        let request: AcpPermissionRequest
        try {
          request = mapPermissionRequest(ctx.params)
        } catch (error) {
          if (error instanceof InvalidAcpApprovalOptionsError) {
            drv.permissionError = new AcpSessionRuntimeError(
              'invalid_approval_options',
              'The ACP agent returned invalid approval options. The task was stopped.',
              false,
              { cause: error },
            )
            return { outcome: { outcome: 'cancelled' as const } }
          }
          throw error
        }
        const r = await b.onPermissionRequest(request)
        if (r.outcome === 'cancelled' || !r.optionId)
          return { outcome: { outcome: 'cancelled' as const } }
        return { outcome: { outcome: 'selected' as const, optionId: r.optionId } }
      })
      .onRequest(methods.client.fs.readTextFile, async (ctx) => {
        const r = readContainedText(cwd, ctx.params.path)
        if (!r.ok) throw new Error(r.error)
        return { content: r.content }
      })
      .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
        const r = writeContainedText(cwd, ctx.params.path, ctx.params.content)
        if (!r.ok) throw new Error(r.error)
        return {}
      })
      .onNotification(methods.client.session.update, (ctx) => {
        const notifSid = (ctx.params as Record<string, unknown>)?.sessionId
        if (notifSid && notifSid !== drv._agentSessionId) return
        if (drv.isLoadPhase) return
        const b = drv.currentBinding
        if (!b) return
        try {
          const update = ctx.params.update as {
            sessionUpdate?: string
            content?: { type?: string; text?: unknown }
          }
          // Type-safe consumption: known types handled; unknown never throw.
          if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
            const text = String(update.content.text ?? '')
            drv._outputAcc += text
            b.sequence++
            try {
              b.onOutputDelta?.(b.sequence, text)
            } catch {
              // Rendering/telemetry observers must not break the ACP transport.
            }
            return
          }
          // thought/tool/plan/usage/config/session-info: accepted, not rendered here
        } catch {
          // Malformed updates must not abort the stream.
        }
      })

    const conn = app.connect(transportStream)
    drv.conn = conn
    drv.agent = conn.agent

    return drv
  }

  static async fromChildProcess(
    cwd: string,
    stdin: WritableStream<Uint8Array>,
    stdout: ReadableStream<Uint8Array>,
  ): Promise<AcpSessionDriver> {
    const stream = ndJsonStream(stdin, stdout)
    return AcpSessionDriver.connect(cwd, stream)
  }

  get agentSessionId(): string | null {
    return this._agentSessionId
  }

  get configOptions(): SessionConfigOption[] {
    return this._configOptions
  }

  get capabilities(): AgentCapabilities {
    return this._capabilities
  }

  get initResponseData(): InitializeResponse | null {
    return this.initResponse
  }

  get authMethods(): AuthMethod[] {
    return this._authMethods
  }

  get agentInfo(): InitializeResponse['agentInfo'] {
    return this._agentInfo
  }

  get partialOutput(): string {
    return this._outputAcc
  }

  /** Client capabilities actually implemented by this driver (not future work). */
  static buildClientCapabilities(opts: InitializeDriverOptions = {}): ClientCapabilities {
    const caps: ClientCapabilities = {
      fs: { readTextFile: true, writeTextFile: true },
    }
    // Do not claim terminal auth until PTY feature is confirmed ready.
    if (opts.terminalAuth) {
      caps.auth = { terminal: true }
    }
    return caps
  }

  async initialize(opts: InitializeDriverOptions = {}): Promise<InitializeResponse> {
    this.initResponse = await this.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: AcpSessionDriver.buildClientCapabilities(opts),
      clientInfo: {
        name: opts.clientName ?? 'swarmdesk-agent',
        version: opts.clientVersion ?? '0.1.0',
      },
    })
    const negotiated = this.initResponse.protocolVersion
    if (typeof negotiated !== 'number' || negotiated !== PROTOCOL_VERSION) {
      this.dispose()
      throw new AcpSessionRuntimeError(
        'protocol_incompatible',
        `ACP protocol version incompatible (agent=${String(negotiated)}, client=${PROTOCOL_VERSION})`,
        false,
      )
    }
    this._capabilities = this.initResponse.agentCapabilities ?? {}
    this._authMethods = this.initResponse.authMethods ?? []
    this._agentInfo = this.initResponse.agentInfo ?? null
    return this.initResponse
  }

  async authenticate(methodId: string): Promise<void> {
    await this.agent.request(methods.agent.authenticate, { methodId })
  }

  async sessionNew(): Promise<NewSessionResponse> {
    const response = await this.agent.request(methods.agent.session.new, {
      cwd: this._cwd,
      mcpServers: [],
    })
    this._agentSessionId = response.sessionId
    this._configOptions = response.configOptions ?? []
    return response
  }

  async sessionResume(agentSessionId: string): Promise<ResumeSessionResponse> {
    this._agentSessionId = agentSessionId
    const response = await this.agent.request(methods.agent.session.resume, {
      sessionId: agentSessionId,
      cwd: this._cwd,
      mcpServers: [],
    })
    this._configOptions = response.configOptions ?? []
    return response
  }

  async sessionLoad(agentSessionId: string): Promise<LoadSessionResponse> {
    this.isLoadPhase = true
    this._agentSessionId = agentSessionId
    try {
      const response = await this.agent.request(methods.agent.session.load, {
        sessionId: agentSessionId,
        cwd: this._cwd,
        mcpServers: [],
      })
      this._configOptions = response.configOptions ?? []
      return response
    } finally {
      this.isLoadPhase = false
    }
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this._agentSessionId) throw new Error('No active session')
    await this.agent.request(methods.agent.session.setConfigOption, {
      sessionId: this._agentSessionId,
      configId,
      value,
    })
  }

  async prompt(task: string, binding: PromptBinding): Promise<PromptResult> {
    if (!this._agentSessionId) return { ok: false, output: '', error: 'No active session' }
    if (binding.signal?.aborted) return { ok: false, output: '', error: 'Cancelled' }

    this.currentBinding = binding
    this._outputAcc = ''
    this.permissionError = null

    let onAbort: (() => void) | undefined
    if (binding.signal) {
      onAbort = () => {
        try {
          this.agent
            .notify(methods.agent.session.cancel, { sessionId: this._agentSessionId! })
            .catch(() => {})
        } catch {}
      }
      binding.signal.addEventListener('abort', onAbort, { once: true })
      if (binding.signal.aborted) {
        binding.signal.removeEventListener('abort', onAbort)
        this.currentBinding = null
        return { ok: false, output: '', error: 'Cancelled' }
      }
    }

    try {
      const response = await this.agent.request(methods.agent.session.prompt, {
        sessionId: this._agentSessionId,
        prompt: [{ type: 'text', text: task }],
      })

      if (this.permissionError) throw this.permissionError

      if (onAbort && binding.signal) binding.signal.removeEventListener('abort', onAbort)

      const output = this._outputAcc
      const stopReason = normalizeStopReason(response.stopReason)
      const ok = stopReason === 'end_turn'

      if (stopReason === 'cancelled') {
        this.currentBinding = null
        return { ok: false, output, stopReason, error: 'Cancelled' }
      }

      this.currentBinding = null
      return {
        ok,
        output,
        stopReason,
        error: ok ? undefined : stopReasonPublicError(stopReason),
      }
    } catch (e) {
      if (onAbort && binding.signal) binding.signal.removeEventListener('abort', onAbort)
      this.currentBinding = null
      const failure = this.permissionError ?? e
      if (failure instanceof AcpSessionRuntimeError) throw failure
      return {
        ok: false,
        output: this._outputAcc,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  async cancel(): Promise<void> {
    if (!this._agentSessionId) return
    try {
      await this.agent.notify(methods.agent.session.cancel, { sessionId: this._agentSessionId })
    } catch {}
  }

  hasCapability(cap: 'resume' | 'load' | 'close' | 'delete' | 'logout'): boolean {
    if (!this._capabilities) return false
    if (cap === 'logout') {
      return (
        this._capabilities.auth?.logout !== undefined && this._capabilities.auth.logout !== null
      )
    }
    if (cap === 'resume') {
      return (
        this._capabilities.sessionCapabilities?.resume !== undefined &&
        this._capabilities.sessionCapabilities?.resume !== null
      )
    }
    if (cap === 'load') {
      return Boolean(this._capabilities.loadSession)
    }
    return (
      this._capabilities.sessionCapabilities?.[cap] !== undefined &&
      this._capabilities.sessionCapabilities?.[cap] !== null
    )
  }

  async closeSession(agentSessionId = this._agentSessionId): Promise<void> {
    if (!agentSessionId) return
    await this.agent.request(methods.agent.session.close, { sessionId: agentSessionId })
    if (this._agentSessionId === agentSessionId) this._agentSessionId = null
  }

  async deleteSession(agentSessionId = this._agentSessionId): Promise<void> {
    if (!agentSessionId) return
    await this.agent.request(methods.agent.session.delete, { sessionId: agentSessionId })
    if (this._agentSessionId === agentSessionId) this._agentSessionId = null
  }

  async logout(): Promise<void> {
    await this.agent.request(methods.agent.logout, {})
  }

  close(): void {
    try {
      this.conn?.close()
    } catch {}
  }

  dispose(): void {
    this.currentBinding = null
    this.close()
  }
}
