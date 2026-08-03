import React, { useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/locales'
import { api, type RegistryOperationSnapshot, type RegistryPrepareResult } from '../lib/api'

type PrepareOperation = RegistryOperationSnapshot<RegistryPrepareResult>
type PrepareEvent = PrepareOperation['events'][number]

function terminal(status: RegistryOperationSnapshot['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

async function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

export async function pollRegistryOperationUntilTerminal<T = RegistryPrepareResult>(input: {
  operationId: string
  signal: AbortSignal
  getOperation?: (operationId: string, signal: AbortSignal) => Promise<RegistryOperationSnapshot<T>>
  onSnapshot: (snapshot: RegistryOperationSnapshot<T>) => void
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
  intervalMs?: number
}): Promise<RegistryOperationSnapshot<T>> {
  const getOperation =
    input.getOperation ??
    ((operationId, signal) => api.getRegistryOperation<T>(operationId, signal))
  const wait = input.wait ?? abortableWait
  while (true) {
    input.signal.throwIfAborted()
    const snapshot = await getOperation(input.operationId, input.signal)
    input.signal.throwIfAborted()
    input.onSnapshot(snapshot)
    if (terminal(snapshot.status)) return snapshot
    await wait(input.intervalMs ?? 350, input.signal)
  }
}

/** Map owner stage tokens to localized labels. Unknown stages fall back to running. */
export function prepareStageLabel(
  stage: string | undefined,
  status: RegistryOperationSnapshot['status'],
  t: (key: MessageKey) => string,
): string {
  if (status === 'queued' && (!stage || stage === 'queued')) {
    return t('workers.registryPrepareQueued')
  }
  if (status === 'succeeded' || stage === 'succeeded') {
    return t('workers.registryPrepareComplete')
  }
  if (status === 'cancelled' || stage === 'cancelled') {
    return t('workers.registryPrepareCancelled')
  }
  if (status === 'failed' || stage === 'failed') {
    return t('workers.registryPrepareFailed')
  }
  switch (stage) {
    case 'resolving':
    case 'queued':
    case 'running':
      return t('workers.registryPrepareStageResolving')
    case 'fetching_icon':
      return t('workers.registryPrepareStageFetchingIcon')
    case 'downloading':
      return t('workers.registryPrepareStageDownloading')
    case 'installing':
    case 'preparing':
      return t('workers.registryPrepareStageInstalling')
    case 'finalizing':
      return t('workers.registryPrepareStageFinalizing')
    case 'authenticating':
      return t('workers.registryPrepareStageAuthenticating')
    default:
      return t('workers.registryPrepareRunning')
  }
}

/** Collapse consecutive identical stages so the log stays readable. */
export function collapsePrepareLogEvents(events: PrepareEvent[]): PrepareEvent[] {
  const out: PrepareEvent[] = []
  for (const event of events) {
    const prev = out[out.length - 1]
    if (prev && prev.stage === event.stage && prev.status === event.status) {
      // Keep the latest timestamp/progress for the same stage.
      out[out.length - 1] = event
      continue
    }
    out.push(event)
  }
  return out
}

function formatLogTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return date.toISOString().slice(11, 19)
  }
}

export function WorkerPrepareProgress(props: {
  initial: PrepareOperation
  onSucceeded: (result: RegistryPrepareResult) => void
  onFailed: (snapshot: PrepareOperation) => void
  onRetry?: () => void
  onCancel?: () => void
}) {
  const { t, locale } = useI18n()
  const [snapshot, setSnapshot] = useState(props.initial)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const callbacks = useRef({
    onSucceeded: props.onSucceeded,
    onFailed: props.onFailed,
  })
  callbacks.current = {
    onSucceeded: props.onSucceeded,
    onFailed: props.onFailed,
  }

  useEffect(() => {
    setSnapshot(props.initial)
    if (terminal(props.initial.status)) return
    const controller = new AbortController()
    void pollRegistryOperationUntilTerminal({
      operationId: props.initial.operationId,
      signal: controller.signal,
      onSnapshot: setSnapshot,
    })
      .then((finalSnapshot) => {
        if (finalSnapshot.status === 'succeeded' && finalSnapshot.result) {
          callbacks.current.onSucceeded(finalSnapshot.result)
        } else {
          callbacks.current.onFailed(finalSnapshot)
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error as { name?: string })?.name === 'AbortError') return
        callbacks.current.onFailed({
          ...props.initial,
          status: 'failed',
          code: 'ACP_INSTALL_FAILED',
          error: t('workers.registryPrepareFailed'),
        })
      })
    // StrictMode/navigation cleanup only disconnects the poll. Explicit cancel
    // is the sole renderer action that aborts the Owner operation.
    return () => controller.abort()
  }, [props.initial.operationId, t])

  const logLines = useMemo(
    () => collapsePrepareLogEvents(snapshot.events),
    [snapshot.events],
  )

  // Auto-scroll as new stages arrive.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [logLines.length, snapshot.status, snapshot.error])

  const bcp47 = locale === 'zh' ? 'zh-CN' : locale === 'zh-TW' ? 'zh-TW' : 'en-US'
  const isActive = !terminal(snapshot.status)

  const cancel = async () => {
    try {
      const cancelled = await api.cancelRegistryOperation(snapshot.operationId)
      setSnapshot(cancelled)
      callbacks.current.onFailed(cancelled)
      props.onCancel?.()
    } catch {
      // The polling path will surface the stable Owner error if cancellation raced.
    }
  }

  return (
    <div className={`worker-prepare-progress status-${snapshot.status}`} role="status">
      <div className="worker-prepare-progress-head">
        <span>{t('workers.registryPrepareLogTitle')}</span>
        {snapshot.code && <code>{snapshot.code}</code>}
      </div>
      <div className="worker-prepare-log" aria-live="polite" aria-relevant="additions">
        {logLines.length === 0 && (
          <div className="worker-prepare-log-line is-pending">
            <span className="worker-prepare-log-time">···</span>
            <span className="worker-prepare-log-msg">{t('workers.registryPrepareQueued')}</span>
          </div>
        )}
        {logLines.map((event, index) => {
          const isLast = index === logLines.length - 1
          const lineStatus =
            event.status === 'failed' || event.stage === 'failed'
              ? 'error'
              : event.status === 'succeeded' || event.stage === 'succeeded'
                ? 'ok'
                : event.status === 'cancelled' || event.stage === 'cancelled'
                  ? 'warn'
                  : isLast && isActive
                    ? 'active'
                    : 'done'
          return (
            <div
              key={`${event.sequence}-${event.stage}`}
              className={`worker-prepare-log-line is-${lineStatus}`}
            >
              <span className="worker-prepare-log-time">
                {formatLogTime(event.at, bcp47) || '···'}
              </span>
              <span className="worker-prepare-log-msg">
                {prepareStageLabel(event.stage, event.status, t)}
                {isLast && isActive && lineStatus === 'active' ? (
                  <span className="worker-prepare-log-spinner" aria-hidden />
                ) : null}
              </span>
            </div>
          )
        })}
        {snapshot.error && (
          <div className="worker-prepare-log-line is-error">
            <span className="worker-prepare-log-time">!</span>
            <span className="worker-prepare-log-msg">{snapshot.error}</span>
          </div>
        )}
        <div ref={logEndRef} />
      </div>
      <div className="worker-prepare-progress-actions">
        {isActive && (
          <button type="button" className="btn-ghost" onClick={() => void cancel()}>
            {t('workers.registryPrepareCancel')}
          </button>
        )}
        {(snapshot.status === 'failed' || snapshot.status === 'cancelled') && props.onRetry && (
          <button type="button" className="btn-ghost" onClick={props.onRetry}>
            {t('workers.registryPrepareRetry')}
          </button>
        )}
      </div>
    </div>
  )
}
