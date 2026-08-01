import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CustomAcpRegistrationInput,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { SettingsPanel } from './SettingsPanel'

type SettingsTab = 'general' | 'model' | 'prompts' | 'workers' | 'about'

export const OPEN_SETTINGS_EVENT = 'swarmdesk-agent:open-settings'
export const SETTINGS_CLOSED_EVENT = 'swarmdesk-agent:settings-closed'

/**
 * Isolated settings host: owns open/mounted state so toggling settings does NOT
 * re-render the workspace tree (major INP win — AppShell stays still).
 */
export function SettingsLayer({
  workers,
  projectId,
  onToggleWorker,
  onSetWorkerDefaultRoleType,
  onHealthAllWorkers,
  onRegisterCustomAcpWorker,
  onRefreshSnapshot,
  onOpen,
}: {
  workers: WorkerRegistration[]
  projectId: string | null
  onToggleWorker: (id: string, enabled: boolean) => void
  onSetWorkerDefaultRoleType: (id: string, roleType: WorkerRole) => Promise<unknown>
  onHealthAllWorkers: () => void
  onRegisterCustomAcpWorker: (body: CustomAcpRegistrationInput) => Promise<unknown>
  onRefreshSnapshot: () => void
  /** Fired when settings becomes visible (e.g. close inspector). */
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState<SettingsTab | undefined>()

  useEffect(() => {
    const openTo = (nextTab?: string) => {
      if (
        nextTab === 'workers' ||
        nextTab === 'model' ||
        nextTab === 'prompts' ||
        nextTab === 'general' ||
        nextTab === 'about'
      ) {
        setTab(nextTab)
      } else if (nextTab) {
        setTab('workers')
      }
      setMounted(true)
      setOpen(true)
      onOpen?.()
    }
    const onEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: string }>).detail
      openTo(detail?.tab)
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, onEvent)
    // Electron menu uses the same event name (already dispatched from App).
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onEvent)
  }, [onOpen])

  // Idle warm-mount so first open isn't a cold 200–300ms SettingsPanel render.
  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let idleId: number | undefined
    const warm = () => {
      if (!cancelled) setMounted(true)
    }
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(warm, { timeout: 2500 })
    } else {
      timeoutId = setTimeout(warm, 1200)
    }
    return () => {
      cancelled = true
      if (idleId != null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId)
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [])

  const leave = useCallback(() => {
    // Flip closed first for immediate paint; side effects after next frame.
    setOpen(false)
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event(SETTINGS_CLOSED_EVENT))
      onRefreshSnapshot()
    })
  }, [onRefreshSnapshot])

  // Keep panel element identity stable across open toggles so React does not
  // reconcile the entire settings tree on every show/hide (INP).
  const panel = useMemo(
    () => (
      <SettingsPanel
        onClose={leave}
        initialTab={tab}
        workers={workers}
        projectId={projectId}
        onToggleWorker={onToggleWorker}
        onSetWorkerDefaultRoleType={onSetWorkerDefaultRoleType}
        onHealthAllWorkers={onHealthAllWorkers}
        onRegisterCustomAcpWorker={onRegisterCustomAcpWorker}
        onRefreshSnapshot={onRefreshSnapshot}
      />
    ),
    [
      leave,
      tab,
      workers,
      projectId,
      onToggleWorker,
      onSetWorkerDefaultRoleType,
      onHealthAllWorkers,
      onRegisterCustomAcpWorker,
      onRefreshSnapshot,
    ],
  )

  if (!mounted) return null

  return (
    <div
      className={`view-layer view-layer-settings${open ? ' is-open' : ''}`}
      aria-hidden={!open}
    >
      {panel}
    </div>
  )
}

/** Open settings from anywhere without React state in the caller. */
export function openSettings(tab?: SettingsTab): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_EVENT, { detail: tab ? { tab } : {} }),
  )
}
