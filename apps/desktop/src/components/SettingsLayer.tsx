import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CustomAcpRegistrationInput,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { SettingsPanel } from './SettingsPanel'

type SettingsTab = 'general' | 'model' | 'prompts' | 'workers' | 'about'

export const OPEN_SETTINGS_EVENT = 'swarmdesk-agent:open-settings'
export const SETTINGS_CLOSED_EVENT = 'swarmdesk-agent:settings-closed'

function resolveSettingsTab(nextTab?: string): SettingsTab | undefined {
  if (
    nextTab === 'workers' ||
    nextTab === 'model' ||
    nextTab === 'prompts' ||
    nextTab === 'general' ||
    nextTab === 'about'
  ) {
    return nextTab
  }
  if (nextTab) return 'workers'
  return undefined
}

/**
 * Isolated settings host: owns open/mounted state so toggling settings does NOT
 * re-render the workspace tree (major INP win — AppShell stays still).
 *
 * Each time settings is opened from a closed state, SettingsPanel remounts so
 * unsaved drafts (API keys, registration form, rail focus, …) do not leak into
 * the next visit.
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
  /** Bumped on each closed→open transition to remount SettingsPanel. */
  const [instanceKey, setInstanceKey] = useState(0)
  const openRef = useRef(false)

  useEffect(() => {
    const openTo = (nextTab?: string) => {
      const resolved = resolveSettingsTab(nextTab)
      if (!openRef.current) {
        // Fresh visit: drop previous ephemeral UI state.
        setInstanceKey((k) => k + 1)
        setTab(resolved ?? 'general')
      } else if (resolved) {
        // Already open: only switch tab when caller pinpoints one.
        setTab(resolved)
      }
      openRef.current = true
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
  // The warm instance is discarded on the first real open via instanceKey bump.
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
    openRef.current = false
    setOpen(false)
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event(SETTINGS_CLOSED_EVENT))
      onRefreshSnapshot()
    })
  }, [onRefreshSnapshot])

  if (!mounted) return null

  return (
    <div className={`view-layer view-layer-settings${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <SettingsPanel
        key={instanceKey}
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
    </div>
  )
}

/** Open settings from anywhere without React state in the caller. */
export function openSettings(tab?: SettingsTab): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: tab ? { tab } : {} }))
}
