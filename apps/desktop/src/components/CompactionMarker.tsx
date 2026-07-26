/**
 * A horizontal separator rendered in the chat timeline to mark that a context
 * compression happened here. Modelled after the `/compact` marker in other agent
 * UIs: a thin line on each side flanking a small icon + a single status line.
 *
 * Lifecycle: inserted as `running` (with an animated gradient label) the moment
 * compression starts, then updated in-place to `success` / `failed` / `skipped`
 * when the backend call resolves. The marker stays in the timeline as a
 * durable record of where the history was compressed.
 *
 * Token numbers are intentionally NOT shown on the separator (matches the
 * reference UI); the freed-token feedback lives in the toast and the context
 * ring's shrinking number.
 */
import { memo } from 'react'
import type { MessageKey } from '../i18n/locales'
import { useI18n } from '../i18n/I18nProvider'

export type CompactionMarkerStatus = 'running' | 'success' | 'failed' | 'skipped'

export interface CompactionMarkerData {
  /** Stable id for React keying. */
  id: string
  status: CompactionMarkerStatus
  /** Where in the message stream this marker sits — inserted right after the
   * message with this id (or at the head when undefined). */
  afterMessageId?: string | null
  /** Net tokens freed, shown only on `success` (and only when > 0). */
  freedTokens?: number
}

const STATUS_LABEL_KEY: Record<CompactionMarkerStatus, MessageKey> = {
  running: 'chat.compactRunning',
  success: 'chat.compactDone',
  failed: 'chat.compactFailed',
  skipped: 'chat.compactSkipped',
}

/** Small compression icon (stacked chevrons squeezing together). */
function CompactIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 5.5L1.5 8L3 10.5" />
      <path d="M13 5.5L14.5 8L13 10.5" />
      <path d="M6 8H10" />
    </svg>
  )
}

export const CompactionMarker = memo(function CompactionMarker({
  status,
  freedTokens,
}: {
  status: CompactionMarkerStatus
  freedTokens?: number
}) {
  const { t, locale } = useI18n()
  const label = t(STATUS_LABEL_KEY[status])
  // On success with a non-trivial saving, append "· 释放 N" so the user gets a
  // concrete number inline (the reference UI omits this, but our users asked
  // for visible feedback — keeping it terse, one inline figure only).
  const suffix =
    status === 'success' && freedTokens && freedTokens > 0
      ? ` · ${t('chat.compactFreed', { freed: formatCompact(freedTokens, locale) })}`
      : ''
  return (
    <div
      className={`compaction-marker is-${status}`}
      role="status"
      aria-live="polite"
      data-status={status}
    >
      <span className="cm-line" aria-hidden />
      <span className="cm-body">
        <CompactIcon />
        <span className="cm-label">{label + suffix}</span>
      </span>
      <span className="cm-line" aria-hidden />
    </div>
  )
})

/** Compact integer formatting: 1234 → "1.2K" / "1234" depending on locale. */
function formatCompact(n: number, locale: string): string {
  if (n >= 1000) {
    const k = n / 1000
    const digits = k >= 100 ? 0 : k >= 10 ? 1 : 1
    return (
      new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        maximumFractionDigits: digits,
        notation: 'compact',
      }).format(n) || String(n)
    )
  }
  return String(n)
}
