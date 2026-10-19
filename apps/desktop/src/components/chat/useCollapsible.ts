import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, type AnimationPlaybackControls } from 'framer-motion'
import { documentPrefersReducedMotion } from '../../lib/motion-preference'

/**
 * 展开动画配置。
 * 显式像素值动画（0 ↔ scrollHeight），不依赖 height:auto 插值。
 */
const TRANSITION = { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const }

/** 折叠后延迟卸载内容的等待时间（等退场动画结束）。 */
const UNMOUNT_DELAY_MS = 220

function prefersReducedMotion(): boolean {
  return documentPrefersReducedMotion()
}

interface CollapsibleOptions {
  /** 受控展开态。 */
  open: boolean
  /** 流式态：为 true 时内容始终挂载（即便折叠也不卸载）。 */
  keepMounted?: boolean
}

interface CollapsibleApi {
  /** 是否应渲染内容（延迟卸载后变 false）。 */
  shouldRender: boolean
  /** 绑到包裹内容的外层容器（height 动画作用于它）。 */
  contentRef: React.RefObject<HTMLDivElement | null>
  /** 当前展开态（透传 open）。 */
  isOpen: boolean
}

/**
 * 共用展开/折叠动画 hook。
 *
 * 用 domReadyRef（DOM 是否首次就绪）+ lastAppliedOpenRef（上次实际应用过的 open 态）
 * 双 ref 判断，避免脆弱的 el.style.height 读取（WAAPI 默认 fill:none，动画结束后
 * 内联 height 不一定反映终态）。
 *
 * 规则：
 * - DOM 首次就绪：设 height:0；若 open 则紧接着展开动画（首次展开也有动画）
 * - open 与上次应用的不同：跑展开/折叠动画
 * - open 与上次应用的相同（shouldRender 变化导致的重跑）：不动
 *
 * lastAppliedOpenRef 只在「DOM 就绪且真正处理完一次」后更新，
 * 所以 open 在 DOM 挂载前变化（el=null 提前 return）不会丢——
 * 下次 DOM 就绪时 prev 仍是 null，走首次就绪分支，但会落入展开动画。
 */
export function useCollapsible({ open, keepMounted = false }: CollapsibleOptions): CollapsibleApi {
  const [shouldRender, setShouldRender] = useState(open || keepMounted)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const animationRef = useRef<AnimationPlaybackControls | null>(null)
  /** DOM 是否已就绪过（首次 snap 用） */
  const domReadyRef = useRef(false)
  /** 上次「真正应用过」的 open 态（动画/snap 执行后更新） */
  const lastAppliedOpenRef = useRef<boolean | null>(null)

  const stop = useCallback(() => {
    animationRef.current?.stop()
    animationRef.current = null
  }, [])

  // 延迟卸载：折叠（且非 keepMounted）后等退场动画再卸载
  useEffect(() => {
    if (open || keepMounted) {
      setShouldRender(true)
      return
    }
    if (!shouldRender) return
    const timer = window.setTimeout(() => setShouldRender(false), UNMOUNT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open, keepMounted, shouldRender])

  const snapOpen = useCallback((el: HTMLElement) => {
    el.style.height = 'auto'
    el.style.overflow = 'visible'
  }, [])

  const runExpand = useCallback(
    (el: HTMLElement) => {
      if (document.hidden || prefersReducedMotion()) {
        snapOpen(el)
        return
      }
      el.style.height = '0px'
      el.style.overflow = 'hidden'
      void el.offsetHeight // 强制 reflow 让起点 0px 生效
      const target = el.scrollHeight
      if (target <= 0) {
        requestAnimationFrame(() => {
          const retry = el.scrollHeight
          if (retry <= 0) {
            snapOpen(el)
            return
          }
          const a = animate(el, { height: retry }, TRANSITION)
          animationRef.current = a
          a.finished
            .then(() => {
              if (animationRef.current !== a) return
              animationRef.current = null
              snapOpen(el)
            })
            .catch(() => snapOpen(el))
        })
        return
      }
      const a = animate(el, { height: target }, TRANSITION)
      animationRef.current = a
      a.finished
        .then(() => {
          if (animationRef.current !== a) {
            if (el.style.height === '0px') snapOpen(el)
            return
          }
          animationRef.current = null
          snapOpen(el)
        })
        .catch(() => {
          snapOpen(el)
        })
    },
    [snapOpen],
  )

  const runCollapse = useCallback((el: HTMLElement) => {
    if (document.hidden || prefersReducedMotion()) {
      el.style.height = '0px'
      el.style.overflow = 'hidden'
      return
    }
    el.style.height = `${el.scrollHeight}px`
    el.style.overflow = 'hidden'
    void el.offsetHeight
    const a = animate(el, { height: 0 }, TRANSITION)
    animationRef.current = a
    a.finished
      .then(() => {
        if (animationRef.current !== a) return
        animationRef.current = null
        el.style.height = '0px'
        el.style.overflow = 'hidden'
      })
      .catch(() => undefined)
  }, [])

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    const prev = lastAppliedOpenRef.current

    // 流式展开态（keepMounted + open）：内容持续增长，直接 height:auto，
    // 不跑 0→scrollHeight 动画——否则 streaming 重渲染会中断动画的 finished
    // 回调，导致 height 卡在 0px（内容不可见）。
    if (open && keepMounted) {
      stop()
      el.style.height = 'auto'
      el.style.overflow = 'visible'
      lastAppliedOpenRef.current = true
      domReadyRef.current = true
      return
    }

    // DOM 首次就绪：snap 到折叠起点。若 open，紧接着展开（首次展开也有动画）。
    if (!domReadyRef.current) {
      domReadyRef.current = true
      el.style.height = '0px'
      el.style.overflow = 'hidden'
      lastAppliedOpenRef.current = false // 起点记为折叠态
      if (open) {
        runExpand(el)
        lastAppliedOpenRef.current = true
      }
      return
    }

    // open 没变：进行中的展开不要打断；若动画已被卸掉且高度卡在 0，重跑展开。
    if (prev === open) {
      if (open && !animationRef.current && el.style.height === '0px') {
        runExpand(el)
      }
      return
    }

    stop()
    if (open) {
      runExpand(el)
    } else {
      runCollapse(el)
    }
    lastAppliedOpenRef.current = open
  }, [open, keepMounted, shouldRender, stop, runExpand, runCollapse])

  // 卸载清理
  useEffect(() => () => stop(), [stop])

  return { shouldRender, contentRef, isOpen: open }
}
