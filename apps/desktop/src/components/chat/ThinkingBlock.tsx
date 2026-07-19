import { memo, useCallback } from 'react'
import { useCollapsible } from './useCollapsible'

type Props = {
  /** Reasoning text. */
  text: string
  /** True while reasoning is still streaming. */
  streaming: boolean
  /** Controlled open state (parent persists). */
  open: boolean
  onToggle: (open: boolean) => void
  /** Collapsed label, e.g. "思考" / "Thinking". */
  label: string
  /** Label used while streaming, e.g. "思考中". */
  streamingLabel: string
}

const PREVIEW_MAX = 72

function previewLine(text: string): string {
  // 折叠态只展示第一行（以换行符为界），不把多行压成一行
  const firstLine = text.split('\n', 1)[0]?.trim() ?? ''
  if (!firstLine) return ''
  return firstLine.length > PREVIEW_MAX ? `${firstLine.slice(0, PREVIEW_MAX - 1)}…` : firstLine
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BrainIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3.2l2.2 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Reasoning block. Expand/collapse via useCollapsible (JS Web Animations API).
 * 设计：
 * - 不用 <details>，受控 div + role=button
 * - height 像素动画（0 ↔ scrollHeight）+ 内层 opacity/translateY
 * - 流式时内容常驻（keepMounted），结束后释放 height:auto 可继续增长
 */
export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  streaming,
  open,
  onToggle,
  label,
  streamingLabel,
}: Props) {
  const isOpen = open
  const { shouldRender, contentRef } = useCollapsible({ open, keepMounted: streaming })
  const preview = !isOpen && !streaming ? previewLine(text) : ''

  const toggle = useCallback(() => onToggle(!isOpen), [isOpen, onToggle])
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    },
    [toggle],
  )

  return (
    <div className={`thinking-block${streaming ? ' live' : ''}${isOpen ? ' is-open' : ''}`}>
      <div
        className="thinking-block-summary"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className="tb-icon-slot" aria-hidden>
          <span className="tb-icon tb-icon-type">
            <BrainIcon />
          </span>
          <span className="tb-icon tb-icon-chevron">
            <ChevronIcon />
          </span>
        </span>
        <span className="thinking-block-label">
          {streaming ? streamingLabel : label}
        </span>
        {preview ? (
          <span className="thinking-block-preview" title={text}>
            {preview}
          </span>
        ) : null}
      </div>

      {shouldRender && (
        <div ref={contentRef} aria-hidden={!isOpen} className="thinking-block-collapse">
          <div
            className="thinking-block-inner"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            }}
          >
            <div className={`thinking-block-body${streaming ? ' live' : ''}`}>
              {text || '…'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
