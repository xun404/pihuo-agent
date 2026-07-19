import React, { useEffect, useRef, useState } from 'react'

import { useI18n } from '../i18n/I18nProvider'
import { api, type RegistryOperationSnapshot, type RegistryPrepareResult } from '../lib/api'

type PrepareOperation = RegistryOperationSnapshot<RegistryPrepareResult>

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

export function WorkerPrepareProgress(props: {
  initial: PrepareOperation
  onSucceeded: (result: RegistryPrepareResult) => void
  onFailed: (snapshot: PrepareOperation) => void
  onRetry?: () => void
  onCancel?: () => void
}) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState(props.initial)
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

  const latestEvent = snapshot.events.at(-1)
  const label =
    snapshot.status === 'queued'
      ? t('workers.registryPrepareQueued')
      : snapshot.status === 'running'
        ? t('workers.registryPrepareRunning')
        : snapshot.status === 'succeeded'
          ? t('workers.registryPrepareComplete')
          : snapshot.status === 'cancelled'
            ? t('workers.registryPrepareCancelled')
            : t('workers.registryPrepareFailed')

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
        <span>{label}</span>
        {snapshot.code && <code>{snapshot.code}</code>}
      </div>
      {latestEvent?.progress !== undefined && (
        <progress max={1} value={latestEvent.progress} aria-label={label} />
      )}
      {snapshot.error && <p className="settings-field-hint">{snapshot.error}</p>}
      <div className="worker-prepare-progress-actions">
        {!terminal(snapshot.status) && (
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
