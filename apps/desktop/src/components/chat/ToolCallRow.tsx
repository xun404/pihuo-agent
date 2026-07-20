import { memo, useCallback } from 'react'
import { formatElapsedSeconds } from '../../lib/format-elapsed'
import { buildToolTerminalView, toolCommandPreview } from '../../lib/tool-terminal-display'
import { useCollapsible } from './useCollapsible'
import { getToolIcon } from '../Icons'

type Props = {
  /** Tool display name (already stripped of `tool-` prefix). */
  name: string
  /** Tool call input payload (unknown shape). */
  input?: unknown
  /** Tool call output payload (unknown shape). */
  output?: unknown
  /** Error text from the runtime, if any. */
  errorText?: string
  /** Seconds elapsed; null while unknown (e.g. before start). */
  durationSec: number | null
  /** True while the tool is still executing. */
  running: boolean
  /** Controlled open state (persisted by parent). */
  open: boolean
  onToggle: (open: boolean) => void
  /** Label for the error badge (i18n). */
  errorLabel: string
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ToolIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4 6.5L6.2 8.2L4 10"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.5 10.2H11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Compact tool-call row: `[icon] Name 1.3s <command preview>`.
 * Expanded body renders like a terminal: `$ command` then raw stdout text.
 *
 * Expand/collapse via useCollapsible（JS Web Animations API）：
 * 不用 <details>，受控 div + role=button，height 像素动画。
 */
export const ToolCallRow = memo(function ToolCallRow({
  name,
  input,
  output,
  errorText,
  durationSec,
  running,
  open,
  onToggle,
  errorLabel,
}: Props) {
  const cmdPreview = toolCommandPreview(input)
  const view = buildToolTerminalView(input, output, errorText)
  const hasDetail = Boolean(view.command || view.stdout || view.stderr)
  const isOpen = open
  const { shouldRender, contentRef } = useCollapsible({ open, keepMounted: running })
  const ToolIconComp = getToolIcon(name)

  const toggle = useCallback(() => {
    if (!hasDetail) return
    onToggle(!isOpen)
  }, [hasDetail, isOpen, onToggle])
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!hasDetail) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    },
    [hasDetail, toggle],
  )

  return (
    <div
      className={`tool-row${errorText ? ' is-error' : ''}${running ? ' is-running' : ''}${isOpen ? ' is-open' : ''}`}
    >
      <div
        className="tool-row-summary"
        role={hasDetail ? 'button' : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        aria-expanded={hasDetail ? isOpen : undefined}
        onClick={hasDetail ? toggle : undefined}
        onKeyDown={hasDetail ? onKeyDown : undefined}
      >
        <span className="tr-icon-slot" aria-hidden>
          <span className="tr-icon tr-icon-type">
            <ToolIconComp size={14} />
          </span>
          <span className="tr-icon tr-icon-chevron">
            <ChevronIcon />
          </span>
        </span>
        <span className="tool-row-name">
          {name}
          {running && (
            <span className="busy-dots" aria-hidden>
              <span className="d" />
              <span className="d" />
              <span className="d" />
            </span>
          )}
        </span>
        {durationSec != null && (
          <span className={`tool-row-duration${running ? ' live' : ''}`}>
            {formatElapsedSeconds(durationSec)}
          </span>
        )}
        {errorText ? <span className="tool-row-error">{errorLabel}</span> : null}
        {cmdPreview && !isOpen ? (
          <span className="tool-row-cmd mono" title={cmdPreview}>
            {cmdPreview}
          </span>
        ) : null}
      </div>

      {shouldRender && hasDetail && (
        <div ref={contentRef} aria-hidden={!isOpen} className="tool-row-collapse">
          <div
            className="node-body-inner"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            }}
          >
            {/* .line 事件流（线稿 node-body-inner .line 1:1）
                command=$ 行，stdout=▸ 行（每行一条），stderr=✗ 行，完成=✓ 行。*/}
            {view.command && (
              <div className="line">
                <span className="mk" aria-hidden>
                  $
                </span>
                <span className="tx">{view.command}</span>
              </div>
            )}
            {view.stdout &&
              view.stdout
                .split('\n')
                .filter(Boolean)
                .map((line, idx) => (
                  <div className="line" key={`o${idx}`}>
                    <span className="mk" aria-hidden>
                      ▸
                    </span>
                    <span className="tx">{line}</span>
                  </div>
                ))}
            {view.stderr &&
              view.stderr
                .split('\n')
                .filter(Boolean)
                .map((line, idx) => (
                  <div className="line" key={`e${idx}`}>
                    <span className="mk err" aria-hidden>
                      ✗
                    </span>
                    <span className="tx">{line}</span>
                  </div>
                ))}
            {!running && !errorText && view.stdout && (
              <div className="line ok">
                <span className="mk" aria-hidden>
                  ✓
                </span>
                <span className="tx">done</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
