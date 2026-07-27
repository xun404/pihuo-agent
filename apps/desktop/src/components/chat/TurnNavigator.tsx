/**
 * TurnNavigator —— 左侧时间线（turn navigator）。
 *
 * 设计线稿（floating-process.html / icon-spec-v3.html ④）：
 *   借鉴 zcode turn-navigator 功能：窄竖栏，每个 user query 一个水平 tick，
 *   fisheye 缩放（当前 query 加长加粗），hover 预览（query 文本 + assistant 摘要），
 *   点击跳转到该 query。
 *
 * 实现：
 *   - 数据：从 messages 提取 role==='user' 的消息（含 assistant 回复预览）
 *   - 活跃 query：IntersectionObserver 监听各 user msg 节点（需 data-msg-id）
 *   - fisheye：基于活跃 idx 计算 distance → scaleX/opacity（CSS class 切换）
 *   - 仅 ≥2 个 query 才渲染（单 query 无需导航）
 *   - 纯 CSS 变量，三套主题自动适配
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { parseRouterUserMessage } from '../../lib/user-message-display'

type AnyMessage = UIMessage<any>

interface QueryItem {
  id: string
  /** user query 显示文本（去 envelope） */
  text: string
  /** 紧随其后的 assistant 回复预览（前 120 字） */
  preview: string
  /** 是否在 live 进行中（最后一条 query + 当前 busy） */
  running: boolean
}

/** 从 messages 提取 query 列表 */
function buildQueries(messages: AnyMessage[], busy: boolean): QueryItem[] {
  const items: QueryItem[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role !== 'user') continue
    // user 显示文本：取第一个 text part，解析 envelope
    const textPart = (msg as { parts?: { type: string; text?: string }[] }).parts?.find(
      (p) => p.type === 'text',
    )
    const rawText = textPart?.text ?? ''
    const { text } = parseRouterUserMessage(rawText)
    const display = (text || rawText || '').trim()

    // 紧随其后的 assistant 预览（到下一个 user 为止，取第一条 assistant 的 text）
    let preview = ''
    for (let j = i + 1; j < messages.length; j++) {
      const m = messages[j]!
      if (m.role === 'user') break
      const tp = (m as { parts?: { type: string; text?: string }[] }).parts?.find(
        (p) => p.type === 'text',
      )
      if (tp?.text?.trim()) {
        preview = tp.text.trim().slice(0, 120)
        break
      }
    }

    const isLast = items.length > 0 && i === messages.length - 1 ? false : false
    void isLast
    items.push({
      id: msg.id,
      text: display,
      preview,
      running: false, // 下面统一处理
    })
  }
  // 最后一条 query：若 busy 则标记 running
  if (items.length > 0 && busy) items[items.length - 1]!.running = true
  return items
}

/** fisheye 计算结果（缩小 1/3 后的尺度） */
function fisheye(idx: number, active: number | null): { cls: string; scale: number; op: number } {
  if (active === null) return { cls: 'mid', scale: 1, op: 0.5 }
  const d = Math.abs(idx - active)
  if (d === 0) return { cls: 'peak', scale: 1.8, op: 1 }
  if (d === 1) return { cls: 'near', scale: 1.3, op: 0.8 }
  if (d === 2) return { cls: 'mid', scale: 1, op: 0.65 }
  return { cls: 'far', scale: 1, op: 0.5 }
}

interface Props {
  messages: AnyMessage[]
  busy: boolean
  /** 滚动容器（messages-scroll）ref，用于跳转计算 */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

function TurnNavigatorImpl({ messages, busy, scrollContainerRef }: Props) {
  const queries = useMemo(() => buildQueries(messages, busy), [messages, busy])
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [focusIdx, setFocusIdx] = useState<number | null>(null)
  // 默认不选中：只在用户首次滚动或点击 tick 后才跟踪 active query
  const hasInteractedRef = useRef(false)

  // 用 IntersectionObserver 监听各 user msg 节点，确定当前活跃 query
  useEffect(() => {
    if (queries.length < 2) return
    const container = scrollContainerRef.current
    if (!container) return

    // 找到所有 user msg DOM 节点（需 data-msg-id）
    const els = queries
      .map((q) => container.querySelector(`[data-msg-id="${CSS.escape(q.id)}"]`))
      .filter((el): el is Element => !!el)

    if (els.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // 用户未交互前不主动设 active（保持默认不选中）
        if (!hasInteractedRef.current) {
          void entries
          return
        }
        // 选最靠上（容器顶部附近）可见的 user msg 为活跃 query
        let topIdx: number | null = null
        let topTop = -Infinity
        for (let i = 0; i < els.length; i++) {
          const el = els[i]!
          const rect = el.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          // user msg 顶部在容器顶部下方 120px 内（含刚滚过的）
          if (rect.top <= containerRect.top + 120 && rect.top > topTop) {
            topTop = rect.top
            topIdx = i
          }
        }
        if (topIdx !== null) setActiveIdx(topIdx)
        void entries
      },
      { root: container, threshold: [0, 0.1, 0.5, 1] },
    )

    els.forEach((el) => observer.observe(el))

    // 用户首次滚动后才开始跟踪 active query（默认不选中）
    const onScroll = () => {
      hasInteractedRef.current = true
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      container.removeEventListener('scroll', onScroll)
    }
  }, [queries, scrollContainerRef])

  // focusIdx：hover 优先，否则 active
  const focus = hoverIdx ?? activeIdx

  // 跳转到指定 query
  const jumpTo = (idx: number) => {
    const container = scrollContainerRef.current
    const q = queries[idx]
    if (!container || !q) return
    hasInteractedRef.current = true
    const el = container.querySelector(`[data-msg-id="${CSS.escape(q.id)}"]`)
    if (el) {
      const containerRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const offset = elRect.top - containerRect.top + container.scrollTop
      container.scrollTo({ top: Math.max(0, offset - 8), behavior: 'smooth' })
      setFocusIdx(idx)
    }
  }

  // 点击外部/hover 退出后，恢复 active 为 focus。
  // 注意：必须在 early return 之前调用（Rules of Hooks）。
  useEffect(() => {
    if (hoverIdx === null && focusIdx !== null) {
      const t = setTimeout(() => setFocusIdx(null), 600)
      return () => clearTimeout(t)
    }
  }, [hoverIdx, focusIdx])

  // <2 query 不渲染
  if (queries.length < 2) return null

  const displayFocus = focus ?? focusIdx

  return (
    <nav
      className="turn-nav"
      aria-label="query 导航"
      onMouseLeave={() => setHoverIdx(null)}
    >
      <div className="turn-nav-track">
        {queries.map((q, idx) => {
          const f = fisheye(idx, displayFocus)
          return (
            <button
              key={q.id}
              type="button"
              className={`turn-nav-tick ${f.cls}${q.running ? ' running' : ''}`}
              aria-current={idx === activeIdx ? 'location' : undefined}
              aria-label={`跳转到 query ${idx + 1}: ${q.text.slice(0, 60)}`}
              aria-posinset={idx + 1}
              aria-setsize={queries.length}
              data-active={idx === activeIdx ? 'true' : 'false'}
              onMouseEnter={() => setHoverIdx(idx)}
              onFocus={() => setHoverIdx(idx)}
              onClick={() => jumpTo(idx)}
            >
              <span
                className="turn-nav-bar"
                style={{
                  transform: `scaleX(${f.scale})`,
                  opacity: q.running ? Math.max(f.op, 0.72) : f.op,
                }}
              />
            </button>
          )
        })}
      </div>

      {/* hover 预览：垂直跟随被 hover 的 tick（track 居中，step=11px）*/}
      {hoverIdx !== null && queries[hoverIdx] && (
        <div
          className="turn-nav-preview"
          role="tooltip"
          style={{
            top: `calc(50% + ${(hoverIdx - (queries.length - 1) / 2) * 11}px)`,
          }}
        >
          <div className="turn-nav-preview-idx">QUERY {hoverIdx + 1} / {queries.length}</div>
          <div className="turn-nav-preview-q">{queries[hoverIdx]!.text || '(空)'}</div>
          {queries[hoverIdx]!.preview && (
            <div className="turn-nav-preview-a">{queries[hoverIdx]!.preview}</div>
          )}
          {queries[hoverIdx]!.running && (
            <div className="turn-nav-preview-running">
              <span className="turn-nav-preview-running-dot" />
              助手仍在工作
            </div>
          )}
        </div>
      )}
    </nav>
  )
}

export const TurnNavigator = memo(TurnNavigatorImpl)
