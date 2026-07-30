import { memo, useCallback } from 'react'
import { formatElapsedSeconds } from '../../lib/format-elapsed'
import {
  buildToolTerminalView,
  toolCommandPreview,
  type ToolField,
} from '../../lib/tool-terminal-display'
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

function ToolFields({ fields }: { fields: ToolField[] }) {
  return (
    <div className="tool-field-list">
      {fields.map((field) =>
        field.children ? (
          <section className="tool-field-group" key={field.key}>
            <div className="tool-field-group-title">{field.key}</div>
            {field.children.map((child) => (
              <div className="tool-field-row" key={child.key}>
                <span className="tool-field-key">{child.key}</span>
                <span className="tool-field-value">{child.value}</span>
              </div>
            ))}
          </section>
        ) : (
          <div className="tool-field-row" key={field.key}>
            <span className="tool-field-key">{field.key}</span>
            <span className="tool-field-value">{field.value}</span>
          </div>
        ),
      )}
    </div>
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
  const hasDetail = Boolean(
    view.command ||
      view.stdout ||
      view.stderr ||
      view.inputFields.length ||
      view.outputFields.length,
  )
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
        className="tool-row-summary process-row-summary"
        role={hasDetail ? 'button' : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        aria-expanded={hasDetail ? isOpen : undefined}
        onClick={hasDetail ? toggle : undefined}
        onKeyDown={hasDetail ? onKeyDown : undefined}
      >
        <span className="tr-icon-slot process-icon-slot" aria-hidden>
          <span className="tr-icon tr-icon-type process-icon-type">
            <ToolIconComp size={14} />
          </span>
          <span className="tr-icon tr-icon-chevron process-icon-chevron">
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
            className="node-body-inner process-collapse-body"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            }}
          >
            {/* OpenChamber 风格：输入/输出各自是完整内容块，多行文本只显示一个标记。 */}
            {view.command && (
              <div className="tool-row-block tool-row-block-input">
                <span className="tool-row-block-marker" aria-hidden>
                  $
                </span>
                <pre className="tool-row-block-content">{view.command}</pre>
              </div>
            )}
            {view.inputFields.length > 0 && <ToolFields fields={view.inputFields} />}
            {view.stdout && (
              <div className="tool-row-block tool-row-block-output">
                <span className="tool-row-block-marker" aria-hidden>
                  ›
                </span>
                <pre className="tool-row-block-content">{view.stdout}</pre>
              </div>
            )}
            {view.outputFields.length > 0 && <ToolFields fields={view.outputFields} />}
            {view.stderr && (
              <div className="tool-row-block tool-row-block-error">
                <span className="tool-row-block-marker" aria-hidden>
                  ✗
                </span>
                <pre className="tool-row-block-content">{view.stderr}</pre>
              </div>
            )}
            {!running && !errorText && (view.stdout || view.outputFields.length > 0) && (
              <div className="tool-row-status is-success">
                <span aria-hidden>✓</span>
                <span>done</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
