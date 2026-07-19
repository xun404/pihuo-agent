import { useCallback, useEffect, useRef, useState } from 'react'
import {
  mapCatalogResponseToOptions,
  type WorkerRegistryCatalog,
  type WorkerRegistryOption,
} from '../lib/worker-registry'

type CatalogState = {
  loading: boolean
  error: string | null
  catalog: WorkerRegistryCatalog | null
  options: WorkerRegistryOption[]
  stale: boolean
  updateRequired: boolean
}

export type CatalogRequestTicket = {
  sequence: number
  controller: AbortController
}

/** Owns the one in-flight catalog request across refreshes and StrictMode cleanup. */
export class CatalogRequestCoordinator {
  private active: CatalogRequestTicket | null = null
  private sequence = 0

  get activeSignal(): AbortSignal | null {
    return this.active?.controller.signal ?? null
  }

  begin(): CatalogRequestTicket {
    this.abort()
    const ticket = {
      sequence: ++this.sequence,
      controller: new AbortController(),
    }
    this.active = ticket
    return ticket
  }

  isCurrent(ticket: CatalogRequestTicket): boolean {
    return this.active === ticket && !ticket.controller.signal.aborted
  }

  finish(ticket: CatalogRequestTicket): void {
    if (this.active === ticket) this.active = null
  }

  abort(): void {
    this.active?.controller.abort()
    this.active = null
  }
}

/**
 * Snapshot-first catalog fetch with AbortSignal. Shared by AgentWorker UI.
 * Does not install or spawn agents.
 */
export function useAcpRegistryCatalog(opts: {
  fetchCatalog: (signal: AbortSignal, refresh?: boolean) => Promise<WorkerRegistryCatalog>
  enabled?: boolean
}) {
  const enabled = opts.enabled !== false
  const [state, setState] = useState<CatalogState>({
    loading: false,
    error: null,
    catalog: null,
    options: [],
    stale: false,
    updateRequired: false,
  })
  const fetchRef = useRef(opts.fetchCatalog)
  const coordinatorRef = useRef(new CatalogRequestCoordinator())
  fetchRef.current = opts.fetchCatalog

  const load = useCallback(async (refresh = false, background = false) => {
    const ticket = coordinatorRef.current.begin()
    if (!background) setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const catalog = await fetchRef.current(ticket.controller.signal, refresh)
      if (!coordinatorRef.current.isCurrent(ticket)) return false
      setState({
        loading: false,
        error: null,
        catalog,
        options: mapCatalogResponseToOptions(catalog),
        stale: Boolean(catalog.stale),
        updateRequired: Boolean(catalog.updateRequired),
      })
      return true
    } catch (e) {
      if (
        ticket.controller.signal.aborted ||
        (e as { name?: string })?.name === 'AbortError' ||
        !coordinatorRef.current.isCurrent(ticket)
      )
        return false
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }))
      return false
    } finally {
      coordinatorRef.current.finish(ticket)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let mounted = true
    void (async () => {
      const snapshotLoaded = await load(false)
      if (mounted && snapshotLoaded) await load(true, true)
    })()
    return () => {
      mounted = false
      coordinatorRef.current.abort()
    }
  }, [enabled, load])

  return { ...state, refresh: () => load(true) }
}
