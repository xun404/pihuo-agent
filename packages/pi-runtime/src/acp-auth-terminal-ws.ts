/** Owner WebSocket bridge for the controlled terminal-auth PTY. */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  cancelTerminalAuthAttempt,
  consumeTerminalAuthToken,
  getTerminalAuthAttempt,
  resizeTerminalAuth,
  startTerminalAuthProcess,
  TERMINAL_AUTH_MAX_INPUT_FRAME,
  TerminalAuthError,
  writeTerminalAuthInput,
  type TerminalAuthAttempt,
  type TerminalAuthOwnerDependencies,
  type TerminalAuthPtySpawn,
} from './acp-auth-terminal.js'

export const TERMINAL_AUTH_SAFE_PROTOCOL = 'ra-auth-v1'
const TERMINAL_AUTH_TOKEN_PROTOCOL_PREFIX = 'ra-auth-token.'
const TERMINAL_AUTH_MAX_CLIENT_FRAME = TERMINAL_AUTH_MAX_INPUT_FRAME + 256

export type TerminalAuthClientFrame =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'cancel' }

export type TerminalAuthWsSocket = {
  on(event: string, listener: (...args: unknown[]) => void): void
  send(data: string): void
  close(code?: number, reason?: string): void
  readonly readyState: number
}

type WebSocketServerLike = {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (socket: TerminalAuthWsSocket) => void,
  ): void
}

let webSocketServer: WebSocketServerLike | null = null

export function selectTerminalAuthSubprotocol(protocols: Set<string>): string | false {
  return protocols.has(TERMINAL_AUTH_SAFE_PROTOCOL) ? TERMINAL_AUTH_SAFE_PROTOCOL : false
}

async function loadWebSocketServer(): Promise<WebSocketServerLike | null> {
  if (webSocketServer) return webSocketServer
  try {
    const module = (await import('ws')) as unknown as {
      WebSocketServer?: new (options: {
        noServer: boolean
        maxPayload: number
        handleProtocols: (protocols: Set<string>) => string | false
      }) => WebSocketServerLike
      default?: {
        WebSocketServer?: new (options: {
          noServer: boolean
          maxPayload: number
          handleProtocols: (protocols: Set<string>) => string | false
        }) => WebSocketServerLike
      }
    }
    const Constructor = module.WebSocketServer ?? module.default?.WebSocketServer
    if (!Constructor) return null
    webSocketServer = new Constructor({
      noServer: true,
      maxPayload: TERMINAL_AUTH_MAX_CLIENT_FRAME,
      handleProtocols: selectTerminalAuthSubprotocol,
    })
    return webSocketServer
  } catch {
    return null
  }
}

export function extractTerminalAuthTokenFromUpgrade(req: IncomingMessage): string | null {
  const raw = req.headers['sec-websocket-protocol']
  if (typeof raw !== 'string') return null
  const protocols = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (!protocols.includes(TERMINAL_AUTH_SAFE_PROTOCOL)) return null
  const tokens = protocols
    .filter((protocol) => protocol.startsWith(TERMINAL_AUTH_TOKEN_PROTOCOL_PREFIX))
    .map((protocol) => protocol.slice(TERMINAL_AUTH_TOKEN_PROTOCOL_PREFIX.length))
    .filter(Boolean)
  return tokens.length === 1 ? tokens[0]! : null
}

export function parseTerminalAuthUpgradePath(
  urlValue: string,
): { workerId: string; attemptId: string } | null {
  let pathname: string
  try {
    const parsed = new URL(urlValue, 'http://127.0.0.1')
    if (parsed.search) return null
    pathname = parsed.pathname
  } catch {
    return null
  }
  const match = /^\/api\/workers\/([^/]+)\/auth-terminal\/([^/]+)\/ws$/u.exec(pathname)
  if (!match) return null
  try {
    const workerId = decodeURIComponent(match[1]!)
    const attemptId = decodeURIComponent(match[2]!)
    if (!workerId || !attemptId || workerId.includes('/') || attemptId.includes('/')) return null
    return { workerId, attemptId }
  } catch {
    return null
  }
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const actual = Object.keys(value).sort()
  return (
    actual.length === allowed.length &&
    actual.every((key, index) => key === [...allowed].sort()[index])
  )
}

export function parseTerminalAuthClientFrame(raw: unknown): TerminalAuthClientFrame {
  const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : ''
  if (!text || Buffer.byteLength(text, 'utf8') > TERMINAL_AUTH_MAX_CLIENT_FRAME) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Terminal frame is too large', 413)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Invalid terminal frame', 400)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Invalid terminal frame', 400)
  }
  const frame = parsed as Record<string, unknown>
  if (
    frame.type === 'input' &&
    typeof frame.data === 'string' &&
    exactKeys(frame, ['data', 'type']) &&
    Buffer.byteLength(frame.data, 'utf8') <= TERMINAL_AUTH_MAX_INPUT_FRAME
  ) {
    return { type: 'input', data: frame.data }
  }
  if (
    frame.type === 'resize' &&
    Number.isInteger(frame.cols) &&
    Number.isInteger(frame.rows) &&
    exactKeys(frame, ['cols', 'rows', 'type'])
  ) {
    // The authoritative bounds check lives beside the PTY operation.
    if (
      Number(frame.cols) < 20 ||
      Number(frame.cols) > 300 ||
      Number(frame.rows) < 5 ||
      Number(frame.rows) > 200
    ) {
      throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Invalid terminal frame', 400)
    }
    return { type: 'resize', cols: Number(frame.cols), rows: Number(frame.rows) }
  }
  if (frame.type === 'cancel' && exactKeys(frame, ['type'])) {
    return { type: 'cancel' }
  }
  throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Invalid terminal frame', 400)
}

function safeSend(socket: TerminalAuthWsSocket, value: Record<string, unknown>): void {
  try {
    if (socket.readyState === 1) socket.send(JSON.stringify(value))
  } catch {
    /* disconnect handler owns cleanup */
  }
}

function safeClose(socket: TerminalAuthWsSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason)
  } catch {
    /* already closed */
  }
}

export function handleTerminalAuthSocket(
  attempt: TerminalAuthAttempt,
  socket: TerminalAuthWsSocket,
  dependencies: {
    ptySpawn?: TerminalAuthPtySpawn
    owner?: TerminalAuthOwnerDependencies
  } = {},
): void {
  const cancelAndClose = (code: number, reason: string) => {
    void cancelTerminalAuthAttempt(attempt.attemptId)
    safeClose(socket, code, reason)
  }

  try {
    const started = startTerminalAuthProcess(
      attempt,
      {
        onData: (chunk) => safeSend(socket, { type: 'output', data: chunk }),
        onExit: (code) => {
          safeSend(socket, {
            type: 'exit',
            code,
            status: 'exited',
            nextAction: 're-probe',
          })
          safeClose(socket, 1000, 'exited')
        },
        onError: () => {
          safeSend(socket, { type: 'error', code: 'WORKER_AUTH_FAILED' })
          safeClose(socket, 1011, 'terminal failed')
        },
      },
      dependencies,
    )
    if (!started) return
  } catch {
    cancelAndClose(1011, 'terminal failed')
    return
  }

  safeSend(socket, {
    type: 'ready',
    attemptId: attempt.attemptId,
    workerId: attempt.workerId,
  })

  socket.on('message', (raw) => {
    try {
      const frame = parseTerminalAuthClientFrame(raw)
      if (frame.type === 'input') {
        writeTerminalAuthInput(attempt, frame.data)
      } else if (frame.type === 'resize') {
        resizeTerminalAuth(attempt, frame.cols, frame.rows)
      } else {
        safeSend(socket, { type: 'cancelled' })
        cancelAndClose(1000, 'cancelled')
      }
    } catch (error) {
      const closeCode = error instanceof TerminalAuthError && error.httpStatus === 413 ? 1009 : 1008
      cancelAndClose(closeCode, closeCode === 1009 ? 'frame too large' : 'invalid frame')
    }
  })
  socket.on('close', () => {
    void cancelTerminalAuthAttempt(attempt.attemptId)
  })
  socket.on('error', () => {
    void cancelTerminalAuthAttempt(attempt.attemptId)
  })
}

function rejectUpgrade(socket: Duplex, status: 401 | 404 | 503): void {
  const label =
    status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Service Unavailable'
  try {
    socket.write(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\n\r\n`)
  } catch {
    /* */
  }
  try {
    socket.destroy()
  } catch {
    /* */
  }
}

export async function handleTerminalAuthUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  dependencies: {
    desktopToken: string | null
    server?: WebSocketServerLike
    ptySpawn?: TerminalAuthPtySpawn
    owner?: TerminalAuthOwnerDependencies
  },
): Promise<boolean> {
  const path = parseTerminalAuthUpgradePath(req.url ?? '/')
  if (!path) return false
  const server = dependencies.server ?? (await loadWebSocketServer())
  if (!server || !dependencies.desktopToken) {
    rejectUpgrade(socket, 503)
    return true
  }
  const token = extractTerminalAuthTokenFromUpgrade(req)
  const pending = getTerminalAuthAttempt(path.attemptId)
  if (!token || !pending || pending.workerId !== path.workerId) {
    rejectUpgrade(socket, 401)
    return true
  }

  let attempt: TerminalAuthAttempt
  try {
    attempt = consumeTerminalAuthToken(
      {
        token,
        workerId: path.workerId,
        methodId: pending.methodId,
        attemptId: path.attemptId,
        ...(Object.hasOwn(req.headers, 'origin')
          ? { origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined }
          : {}),
        desktopToken: dependencies.desktopToken,
      },
      dependencies.owner,
    )
  } catch (error) {
    rejectUpgrade(
      socket,
      error instanceof TerminalAuthError && error.httpStatus === 503 ? 503 : 401,
    )
    return true
  }

  try {
    server.handleUpgrade(req, socket, head, (webSocket) => {
      handleTerminalAuthSocket(attempt, webSocket, {
        ...(dependencies.ptySpawn ? { ptySpawn: dependencies.ptySpawn } : {}),
        ...(dependencies.owner ? { owner: dependencies.owner } : {}),
      })
    })
  } catch {
    void cancelTerminalAuthAttempt(attempt.attemptId)
    rejectUpgrade(socket, 503)
  }
  return true
}
