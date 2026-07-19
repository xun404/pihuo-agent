import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export type ToastKind = 'success' | 'error' | 'info'

export type ToastInput = {
  message: string
  kind?: ToastKind
  /** ms; default 3200 */
  duration?: number
}

type ToastItem = {
  id: number
  message: string
  kind: ToastKind
  duration: number
}

type ToastContextValue = {
  toast: (input: ToastInput | string) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastIdSeq = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const toast = useCallback(
    (input: ToastInput | string) => {
      const message = typeof input === 'string' ? input : input.message
      if (!message.trim()) return
      const kind = typeof input === 'string' ? 'info' : (input.kind ?? 'info')
      const duration =
        typeof input === 'string' ? 3200 : (input.duration ?? (kind === 'error' ? 4500 : 3200))
      const id = toastIdSeq++
      setItems((prev) => {
        // cap stack to avoid flooding
        const next = [...prev, { id, message: message.trim(), kind, duration }]
        return next.slice(-4)
      })
      const timer = setTimeout(() => dismiss(id), duration)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  const success = useCallback(
    (message: string, duration?: number) => toast({ message, kind: 'success', duration }),
    [toast],
  )
  const error = useCallback(
    (message: string, duration?: number) => toast({ message, kind: 'error', duration }),
    [toast],
  )
  const info = useCallback(
    (message: string, duration?: number) => toast({ message, kind: 'info', duration }),
    [toast],
  )

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t)
      timers.current.clear()
    }
  }, [])

  const value = useMemo(
    () => ({ toast, success, error, info }),
    [toast, success, error, info],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite" aria-relevant="additions">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              className={`toast toast-${item.kind}`}
              role={item.kind === 'error' ? 'alert' : 'status'}
              onClick={() => dismiss(item.id)}
              // 入场：opacity + translateY（替代 CSS toast-in）
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              // 退场：opacity + translateY 反向（toast-out 缓动）
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.175, 0.885, 0.32, 1] }}
              layout
            >
              <span className="toast-msg">{item.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
