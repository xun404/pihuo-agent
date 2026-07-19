import React, { useEffect, useRef, useState } from 'react'

import { useI18n } from '../i18n/I18nProvider'
import { api } from '../lib/api'

const MAX_INPUT_BYTES = 8 * 1024
const MAX_OUTPUT_CHUNK_BYTES = 128 * 1024
const MAX_QUEUED_OUTPUT_BYTES = 128 * 1024
const MAX_TOTAL_OUTPUT_BYTES = 512 * 1024

export type TerminalAuthClientFrame =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'cancel' }

type TerminalAuthServerFrame =
  | { type: 'ready'; attemptId: string; workerId: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number; status: 'exited'; nextAction: 're-probe' }
  | { type: 'error'; code: string }

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const expected = [...allowed].sort()
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

export function encodeTerminalAuthClientFrame(frame: TerminalAuthClientFrame): string {
  if (frame.type === 'input') {
    if (new TextEncoder().encode(frame.data).byteLength > MAX_INPUT_BYTES) {
      throw new Error('Terminal input frame is too large')
    }
  } else if (frame.type === 'resize') {
    if (
      !Number.isInteger(frame.cols) ||
      !Number.isInteger(frame.rows) ||
      frame.cols < 20 ||
      frame.cols > 300 ||
      frame.rows < 5 ||
      frame.rows > 200
    )
      throw new Error('Invalid terminal resize frame')
  }
  return JSON.stringify(frame)
}

export function parseTerminalAuthServerFrame(raw: unknown): TerminalAuthServerFrame {
  if (
    typeof raw !== 'string' ||
    new TextEncoder().encode(raw).byteLength > MAX_OUTPUT_CHUNK_BYTES + 512
  ) {
    throw new Error('Invalid terminal server frame')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Invalid terminal server frame')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid terminal server frame')
  }
  const frame = parsed as Record<string, unknown>
  if (
    frame.type === 'ready' &&
    typeof frame.attemptId === 'string' &&
    typeof frame.workerId === 'string' &&
    exactKeys(frame, ['attemptId', 'type', 'workerId'])
  )
    return { type: 'ready', attemptId: frame.attemptId, workerId: frame.workerId }
  if (
    frame.type === 'output' &&
    typeof frame.data === 'string' &&
    new TextEncoder().encode(frame.data).byteLength <= MAX_OUTPUT_CHUNK_BYTES &&
    exactKeys(frame, ['data', 'type'])
  )
    return { type: 'output', data: frame.data }
  if (
    frame.type === 'exit' &&
    Number.isInteger(frame.code) &&
    frame.status === 'exited' &&
    frame.nextAction === 're-probe' &&
    exactKeys(frame, ['code', 'nextAction', 'status', 'type'])
  )
    return {
      type: 'exit',
      code: Number(frame.code),
      status: 'exited',
      nextAction: 're-probe',
    }
  if (
    frame.type === 'error' &&
    typeof frame.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(frame.code) &&
    exactKeys(frame, ['code', 'type'])
  )
    return { type: 'error', code: frame.code }
  throw new Error('Invalid terminal server frame')
}

export class BoundedTerminalOutputQueue {
  private readonly queued: string[] = []
  private queuedBytes = 0
  private frameId: number | null = null
  private disposed = false
  totalBytes = 0

  constructor(
    private readonly options: {
      maxQueuedBytes?: number
      maxTotalBytes?: number
      write: (value: string) => void
      requestFrame?: (callback: () => void) => number
      cancelFrame?: (id: number) => void
      onLimit: () => void
    },
  ) {}

  enqueue(value: string): boolean {
    if (this.disposed) return false
    const bytes = new TextEncoder().encode(value).byteLength
    if (
      bytes > (this.options.maxQueuedBytes ?? MAX_QUEUED_OUTPUT_BYTES) ||
      this.queuedBytes + bytes > (this.options.maxQueuedBytes ?? MAX_QUEUED_OUTPUT_BYTES) ||
      this.totalBytes + bytes > (this.options.maxTotalBytes ?? MAX_TOTAL_OUTPUT_BYTES)
    ) {
      this.options.onLimit()
      return false
    }
    this.queued.push(value)
    this.queuedBytes += bytes
    if (this.frameId === null) {
      const requestFrame =
        this.options.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback))
      this.frameId = requestFrame(() => this.flush())
    }
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.frameId !== null) {
      const cancelFrame = this.options.cancelFrame ?? cancelAnimationFrame
      cancelFrame(this.frameId)
    }
    this.frameId = null
    this.queued.length = 0
    this.queuedBytes = 0
  }

  private flush(): void {
    if (this.disposed) return
    this.frameId = null
    const value = this.queued.join('')
    const bytes = this.queuedBytes
    this.queued.length = 0
    this.queuedBytes = 0
    if (!value) return
    this.totalBytes += bytes
    this.options.write(value)
  }
}

type DisposableResource = { dispose(): void }
type TerminalSocket = Pick<WebSocket, 'readyState' | 'send' | 'close'>

export class TerminalTransportGuard {
  private settled = false

  markTerminal(): void {
    this.settled = true
  }

  failOnce(onFailure: () => void): boolean {
    if (this.settled) return false
    this.settled = true
    onFailure()
    return true
  }
}

export function createTerminalAuthFrameSender(
  socket: TerminalSocket,
  onFailure: () => void,
): (frame: TerminalAuthClientFrame) => boolean {
  return (frame) => {
    if (socket.readyState !== WebSocket.OPEN && socket.readyState !== 1) return false
    try {
      socket.send(encodeTerminalAuthClientFrame(frame))
      return true
    } catch {
      onFailure()
      try {
        socket.send(encodeTerminalAuthClientFrame({ type: 'cancel' }))
      } catch {
        /* disconnected */
      }
      try {
        socket.close()
      } catch {
        /* disconnected */
      }
      return false
    }
  }
}

export type TerminalAuthSessionResources = {
  socket?: TerminalSocket
  terminal?: DisposableResource
  fitAddon?: DisposableResource
  resizeObserver?: Pick<ResizeObserver, 'disconnect'>
  outputQueue?: Pick<BoundedTerminalOutputQueue, 'dispose'>
  disposed: boolean
}

export function disposeTerminalAuthSession(resources: TerminalAuthSessionResources): void {
  if (resources.disposed) return
  resources.disposed = true
  try {
    if (resources.socket?.readyState === WebSocket.OPEN || resources.socket?.readyState === 1) {
      resources.socket.send(encodeTerminalAuthClientFrame({ type: 'cancel' }))
    }
  } catch {
    /* already disconnected */
  }
  try {
    resources.socket?.close()
  } catch {
    /* already disconnected */
  }
  resources.resizeObserver?.disconnect()
  resources.outputQueue?.dispose()
  resources.fitAddon?.dispose()
  resources.terminal?.dispose()
}

type ModalStatus = 'connecting' | 'ready' | 'verifying' | 'succeeded' | 'failed'

export function WorkerAuthTerminalModal(props: {
  workerId: string
  workerName: string
  methodId: string
  onClose: () => void
  onComplete: () => void
}) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const resourcesRef = useRef<TerminalAuthSessionResources | null>(null)
  const callbacks = useRef({ onComplete: props.onComplete })
  callbacks.current.onComplete = props.onComplete
  const [status, setStatus] = useState<ModalStatus>('connecting')
  const [errorCode, setErrorCode] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const resources: TerminalAuthSessionResources = { disposed: false }
    resourcesRef.current = resources

    void (async () => {
      try {
        const [attempt, xterm, fit] = await Promise.all([
          api.createTerminalAuthAttempt(props.workerId, props.methodId, controller.signal),
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ])
        controller.signal.throwIfAborted()
        if (!hostRef.current || !attempt.ptyReady) throw new Error('terminal unavailable')

        const terminal = new xterm.Terminal({
          convertEol: true,
          cursorBlink: true,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          scrollback: 1_000,
          theme: { background: '#171411', foreground: '#f7f4ef' },
        })
        const fitAddon = new fit.FitAddon()
        terminal.loadAddon(fitAddon)
        terminal.open(hostRef.current)
        fitAddon.fit()
        resources.terminal = terminal
        resources.fitAddon = fitAddon

        const socket = new WebSocket(
          api.terminalAuthWebSocketUrl(props.workerId, attempt.attemptId),
          api.terminalAuthWebSocketProtocols(attempt.token),
        )
        resources.socket = socket
        const transport = new TerminalTransportGuard()
        const markTransportFailed = () =>
          transport.failOnce(() => {
            setErrorCode('WORKER_AUTH_FAILED')
            setStatus('failed')
          })
        const send = createTerminalAuthFrameSender(socket, markTransportFailed)
        const failTransportAndClose = () => {
          if (!markTransportFailed()) return
          try {
            socket.send(encodeTerminalAuthClientFrame({ type: 'cancel' }))
          } catch {
            /* disconnected */
          }
          try {
            socket.close()
          } catch {
            /* disconnected */
          }
        }
        const outputQueue = new BoundedTerminalOutputQueue({
          write: (value) => terminal.write(value),
          onLimit: failTransportAndClose,
        })
        resources.outputQueue = outputQueue

        terminal.onData((data) => send({ type: 'input', data }))
        terminal.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }))
        const resizeObserver =
          typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => {
                try {
                  fitAddon.fit()
                } catch {
                  /* modal is closing */
                }
              })
            : undefined
        resizeObserver?.observe(hostRef.current)
        resources.resizeObserver = resizeObserver

        socket.onmessage = (event) => {
          try {
            const frame = parseTerminalAuthServerFrame(event.data)
            if (frame.type === 'output') {
              outputQueue.enqueue(frame.data)
            } else if (frame.type === 'ready') {
              if (frame.workerId !== props.workerId || frame.attemptId !== attempt.attemptId) {
                throw new Error('terminal identity mismatch')
              }
              setStatus('ready')
            } else if (frame.type === 'error') {
              transport.markTerminal()
              setErrorCode(frame.code)
              setStatus('failed')
            } else if (frame.code === 0) {
              transport.markTerminal()
              setStatus('verifying')
              void api
                .probeRegistryWorker(props.workerId, controller.signal)
                .then(({ worker }) => {
                  if (
                    worker.readiness?.status === 'ready' ||
                    worker.readiness?.status === 'degraded'
                  ) {
                    setStatus('succeeded')
                    callbacks.current.onComplete()
                  } else {
                    setErrorCode(worker.readiness?.code ?? 'WORKER_AUTH_FAILED')
                    setStatus('failed')
                  }
                })
                .catch(() => {
                  if (!controller.signal.aborted) {
                    setErrorCode('WORKER_AUTH_FAILED')
                    setStatus('failed')
                  }
                })
            } else {
              transport.markTerminal()
              setErrorCode('WORKER_AUTH_FAILED')
              setStatus('failed')
            }
          } catch {
            failTransportAndClose()
          }
        }
        socket.onerror = () => {
          if (!controller.signal.aborted && !resources.disposed) markTransportFailed()
        }
        socket.onclose = () => {
          if (!controller.signal.aborted && !resources.disposed) markTransportFailed()
        }
      } catch {
        if (!controller.signal.aborted) {
          setErrorCode('WORKER_AUTH_FAILED')
          setStatus('failed')
        }
      }
    })()

    return () => {
      controller.abort()
      disposeTerminalAuthSession(resources)
      if (resourcesRef.current === resources) resourcesRef.current = null
    }
  }, [props.methodId, props.workerId])

  const label =
    status === 'connecting'
      ? t('workers.terminalConnecting')
      : status === 'ready'
        ? t('workers.terminalReady')
        : status === 'verifying'
          ? t('workers.terminalVerifying')
          : status === 'succeeded'
            ? t('workers.terminalSucceeded')
            : t('workers.terminalFailed')

  const close = () => {
    if (resourcesRef.current) disposeTerminalAuthSession(resourcesRef.current)
    props.onClose()
  }

  return (
    <div className="worker-auth-terminal-backdrop" role="presentation">
      <section
        className="worker-auth-terminal-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('workers.terminalTitle')}
      >
        <header>
          <div>
            <strong>{t('workers.terminalTitle')}</strong>
            <span>{props.workerName}</span>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={close}
            aria-label={t('workers.terminalClose')}
          >
            ×
          </button>
        </header>
        <div ref={hostRef} className="worker-auth-terminal-host" />
        <footer>
          <span role="status">
            {label}
            {errorCode ? ` · ${errorCode}` : ''}
          </span>
          <button type="button" className="btn-ghost" onClick={close}>
            {t('workers.terminalCancel')}
          </button>
        </footer>
      </section>
    </div>
  )
}
