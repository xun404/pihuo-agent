import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { api } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  worker: WorkerRegistration
  /** Called after a probe succeeds so the parent can refresh its snapshot. */
  onProbed?: () => void
}

type LogLevel = 'info' | 'ok' | 'warn' | 'err'

interface LogLine {
  id: number
  ts: Date
  level: LogLevel
  text: string
}

const fmtTs = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`

/** Maximum retained log lines; older lines are dropped from the top. */
const MAX_LOG_LINES = 15

/**
 * ACP probe console — a code-styled log panel with a "re-probe" action.
 *
 * The backend probe is a single synchronous request (no streaming), so each
 * probe produces a structured block of log lines derived from the result:
 * spawn → initialize handshake → capabilities → auth methods → readiness.
 */
export function WorkerProbeConsole({ worker, onProbed }: Props) {
  const { t } = useI18n()
  const [lines, setLines] = useState<LogLine[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const onProbedRef = useRef(onProbed)
  useEffect(() => {
    onProbedRef.current = onProbed
  }, [onProbed])

  const push = useCallback((level: LogLevel, text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: ++seq.current, ts: new Date(), level, text }]
      // Keep at most MAX_LOG_LINES lines; drop the oldest from the top.
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
    })
  }, [])

  // Keep the log scrolled to the latest line.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const runProbe = useCallback(async () => {
    if (busy) return
    setBusy(true)
    // Start each probe with a clean log so runs don't accumulate.
    setLines([])
    push('info', t('workers.probeLogStart', { name: worker.name }))
    push('info', t('workers.probeLogSpawn'))
    const t0 = Date.now()
    try {
      const { worker: after } = await api.probeRegistryWorker(worker.id)
      const elapsed = Date.now() - t0
      const cs = after.capabilitySummary
      push('info', t('workers.probeLogHandshake'))
      if (cs?.protocolVersion) {
        push('ok', t('workers.probeLogProtocol', { version: cs.protocolVersion }))
      }
      if (cs?.agentName || cs?.agentVersion) {
        push(
          'ok',
          t('workers.probeLogAgentInfo', {
            name: cs?.agentName ?? '—',
            version: cs?.agentVersion ?? '—',
          }),
        )
      }
      const caps = [
        cs?.sessionLoad && t('workers.capSessionLoad'),
        cs?.sessionResume && t('workers.capSessionResume'),
        cs?.sessionList && t('workers.capSessionList'),
        cs?.authLogout && t('workers.capLogout'),
      ].filter(Boolean) as string[]
      push(
        caps.length ? 'ok' : 'warn',
        t('workers.probeLogCapabilities', { caps: caps.join(', ') || '—' }),
      )
      const methods = cs?.authMethods ?? []
      if (methods.length > 0) {
        push(
          'ok',
          t('workers.probeLogAuthMethods', {
            methods: methods.map((m) => `${m.name ?? m.id} (${m.type})`).join(', '),
          }),
        )
      } else {
        push('info', t('workers.probeLogNoAuth'))
      }
      const ready =
        after.readiness?.status === 'ready' || after.readiness?.status === 'degraded'
      push(
        ready ? 'ok' : after.readiness?.status === 'auth_required' ? 'warn' : 'err',
        t('workers.probeLogResult', {
          status: after.readiness?.status ?? 'unknown',
          elapsed: String(elapsed),
        }),
      )
      onProbedRef.current?.()
    } catch (error) {
      const elapsed = Date.now() - t0
      const msg = error instanceof Error ? error.message : String(error)
      push('err', t('workers.probeLogFailed', { elapsed: String(elapsed) }))
      push('err', msg)
    } finally {
      setBusy(false)
    }
  }, [busy, push, t, worker.id, worker.name])

  return (
    <div className="worker-detail-card worker-probe-console-card">
      <div className="worker-probe-head">
        <h4 className="worker-detail-card-title">{t('workers.sectionProbe')}</h4>
        <button
          type="button"
          className="settings-save-btn worker-probe-run"
          disabled={busy}
          onClick={() => void runProbe()}
        >
          {busy && <span className="btn-spinner" aria-hidden />}
          {busy ? t('workers.probeRunning') : t('workers.probeRun')}
        </button>
      </div>
      <div className="worker-probe-log" ref={scrollRef} role="log" aria-live="polite">
        {lines.length === 0 ? (
          <p className="worker-probe-log-empty">{t('workers.probeLogEmpty')}</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`worker-probe-log-line is-${line.level}`}>
              <span className="worker-probe-log-ts mono">{fmtTs(line.ts)}</span>
              <span className="worker-probe-log-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
