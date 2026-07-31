import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

interface ModalProps {
  /** 受控开关。false 时触发退场动画，动画结束后卸载。 */
  open: boolean
  /** 关闭回调（ESC / backdrop 点击时调用）。 */
  onClose: () => void
  /** 面板内容。 */
  children: ReactNode
  /** 可访问性标签。 */
  label?: string
  /**
   * 透传给面板的 className（复用现有 .text-prompt-modal 等样式）。
   * backdrop 由本组件自带，不要在外层再包 overlay。
   */
  panelClassName?: string
  /** backdrop 点击是否触发 onClose（默认 true；忙碌态可禁用）。 */
  closeOnBackdrop?: boolean
  /** ESC 是否触发 onClose（默认 true）。 */
  closeOnEsc?: boolean
}

/**
 * 统一模态基座（v4 动画对齐）。
 *
 * - 始终 portal 到 document.body，避免 chat timeline / composer 局部 stacking context 穿模
 * - backdrop：opacity 淡入淡出
 * - panel：opacity + scale(.98→1) + translateY(8px→0)
 * - ESC / backdrop 点击关闭
 * - 打开时锁定 body 滚动
 */
export function Modal({
  open,
  onClose,
  children,
  label,
  panelClassName,
  closeOnBackdrop = true,
  closeOnEsc = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open || !closeOnEsc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeOnEsc, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="settings-overlay text-prompt-overlay modal-overlay-anim"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          onClick={(e) => {
            if (closeOnBackdrop && e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            className={panelClassName ?? 'text-prompt-modal'}
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
