import { useCallback, useEffect, useRef, useState } from 'react'
import {
  mapCatalogResponseToOptions,
  type WorkerRegistryCatalog,
  type WorkerRegistryOption,
} from '../lib/worker-registry'

type CatalogState = {
  loading: boolean
  checking: boolean
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
  fetchCatalog: (signal: AbortSignal) => Promise<WorkerRegistryCatalog>
  checkCatalog: (signal: AbortSignal) => Promise<WorkerRegistryCatalog>
  enabled?: boolean
}) {
  const enabled = opts.enabled !== false
  const [state, setState] = useState<CatalogState>({
    loading: false,
    checking: false,
    error: null,
    catalog: null,
    options: [],
    stale: false,
    updateRequired: false,
  })
  const fetchRef = useRef(opts.fetchCatalog)
  const checkRef = useRef(opts.checkCatalog)
  const coordinatorRef = useRef(new CatalogRequestCoordinator())
  fetchRef.current = opts.fetchCatalog
  checkRef.current = opts.checkCatalog

  const load = useCallback(async (kind: 'local' | 'check') => {
    const ticket = coordinatorRef.current.begin()
    setState((state) => ({
      ...state,
      loading: kind === 'local',
      checking: kind === 'check',
      error: null,
    }))
    try {
      const catalog = await (kind === 'check' ? checkRef : fetchRef).current(
        ticket.controller.signal,
      )
      if (!coordinatorRef.current.isCurrent(ticket)) return null
      setState({
        loading: false,
        checking: false,
        error: null,
        catalog,
        options: mapCatalogResponseToOptions(catalog),
        stale: Boolean(catalog.stale),
        updateRequired: Boolean(catalog.updateRequired),
      })
      return catalog
    } catch (e) {
      if (
        ticket.controller.signal.aborted ||
        (e as { name?: string })?.name === 'AbortError' ||
        !coordinatorRef.current.isCurrent(ticket)
      )
        return null
      setState((s) => ({
        ...s,
        loading: false,
        checking: false,
        error: e instanceof Error ? e.message : String(e),
      }))
      return null
    } finally {
      coordinatorRef.current.finish(ticket)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void load('local')
    return () => {
      coordinatorRef.current.abort()
    }
  }, [enabled, load])

  return { ...state, checkForUpdates: () => load('check') }
}
