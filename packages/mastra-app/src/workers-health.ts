/**
 * Worker health batch/single helpers used by HTTP API.
 */
import {
  applyHealthReport,
  parseHealthDepth,
  probeWorkerHealth,
  type ProbeDepth,
} from '@swarmdesk-agent/adapters'
import { globalActivityLog, getSharedStore } from '@swarmdesk-agent/core'
import type { WorkerHealthReport, WorkerRegistration } from '@swarmdesk-agent/shared'
import { isModelCacheFresh, WORKER_MODELS_TTL_MS } from '@swarmdesk-agent/shared'
import { refreshWorkerModels } from './worker-models.js'

const MAX_NODE_TIMER_MS = 2_147_483_647

export function resolveWorkerPeriodicInterval(
  value: unknown,
  fallbackMs: number,
  minimumMs = 1_000,
): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < minimumMs) return fallbackMs
  return Math.min(Math.floor(numeric), MAX_NODE_TIMER_MS)
}

function store() {
  return getSharedStore()
}

export function depthToLevel(depth: ProbeDepth) {
  if (depth === 'acp') return 'acp_handshake' as const
  if (depth === 'presence') return 'presence' as const
  return 'version' as const
}

export async function checkOneWorker(
  worker: WorkerRegistration,
  depth: ProbeDepth = 'version',
  cwd?: string,
): Promise<{ worker: WorkerRegistration; report: WorkerHealthReport }> {
  const report = await probeWorkerHealth(worker, {
    level: depthToLevel(depth),
    cwd,
  })
  const updated = applyHealthReport(worker, report)
  store().upsertWorker(updated)
  globalActivityLog.append('system', `Worker health ${updated.name}: ${report.status}`, {
    workerId: updated.id,
    status: report.status,
    level: report.level,
    message: report.message,
  })
  return { worker: updated, report }
}

export async function checkWorkersBatch(opts: {
  workerIds?: string[]
  depth?: ProbeDepth | string
  onlyEnabled?: boolean
  cwd?: string
  concurrency?: number
}): Promise<{
  results: { workerId: string; report: WorkerHealthReport }[]
  summary: Record<'healthy' | 'missing' | 'unhealthy' | 'unknown', number>
}> {
  const depth = parseHealthDepth(opts.depth)
  const onlyEnabled = opts.onlyEnabled !== false
  let list = store().listWorkers()
  if (onlyEnabled) list = list.filter((w) => w.enabled)
  if (opts.workerIds?.length) {
    const set = new Set(opts.workerIds)
    list = list.filter((w) => set.has(w.id))
  }

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 2, 4))
  const results: { workerId: string; report: WorkerHealthReport }[] = []
  let i = 0

  async function workerLoop() {
    while (i < list.length) {
      const idx = i++
      const w = list[idx]!
      const { report } = await checkOneWorker(w, depth, opts.cwd)
      results.push({ workerId: w.id, report })
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()))

  const summary = { healthy: 0, missing: 0, unhealthy: 0, unknown: 0 }
  for (const r of results) {
    const s = r.report.status
    if (s in summary) summary[s as keyof typeof summary] += 1
  }

  return { results, summary }
}

/** Fire-and-forget startup / interval refresh for enabled workers. */
export function scheduleAutoWorkerHealth(): void {
  if (process.env.WORKER_HEALTH_AUTO === '0' || process.env.WORKER_HEALTH_AUTO === 'false') {
    return
  }
  const ttl = resolveWorkerPeriodicInterval(process.env.WORKER_HEALTH_TTL_MS, 300_000)

  let healthRunInFlight = false
  const run = () => {
    if (healthRunInFlight) return
    healthRunInFlight = true
    void checkWorkersBatch({ depth: 'version', onlyEnabled: true })
      .catch((e) => {
        console.warn('[workers-health] auto check failed', e)
      })
      .finally(() => {
        healthRunInFlight = false
      })
  }

  // Don't block server listen
  const startupHealthTimer = setTimeout(run, 800)
  startupHealthTimer.unref?.()
  const healthTimer = setInterval(run, ttl)
  healthTimer.unref?.()

  // Soft auto-detect once shortly after boot (enable installed CLIs)
  const detectTimer = setTimeout(() => {
    void (async () => {
      try {
        const { detectAcpWorkers, applyDetectionToWorkers } =
          await import('@swarmdesk-agent/adapters')
        const { createId } = await import('@swarmdesk-agent/core')
        const candidates = await detectAcpWorkers()
        const existing = store().listWorkers()
        // First boot: many unknown workers — apply detection
        const neverProbed = existing.every((w) => !w.lastSeenAt)
        if (!neverProbed && candidates.every((c) => !c.installed)) return

        const merged = applyDetectionToWorkers(existing, candidates, {
          createMissing: true,
          autoDisableMissing: false,
        })
        for (const w of merged.workers) {
          if (w.id.startsWith('detect-')) {
            store().upsertWorker({ ...w, id: createId('worker') })
          } else {
            store().upsertWorker(w)
          }
        }
        if (merged.recommended.length) {
          globalActivityLog.append(
            'system',
            `Auto-detect workers: ${merged.recommended.map((c) => c.name).join(', ')}`,
            { kinds: merged.recommended.map((c) => c.kind) },
          )
        }
      } catch (e) {
        console.warn('[workers-health] auto-detect failed', e)
      }
    })()
  }, 1200)
  detectTimer.unref?.()

  // Periodically refresh stale model caches via SWR (non-force, single-flight/backoff)
  const modelsRefreshMs = resolveWorkerPeriodicInterval(
    process.env.WORKER_MODELS_REFRESH_MS,
    900_000,
  )
  const modelsTimer = setInterval(() => {
    const workers = store()
      .listWorkers()
      .filter((w) => w.enabled)
    for (const w of workers) {
      const stale =
        w.modelCatalogState === 'stale' ||
        w.modelCatalogState === 'empty' ||
        w.modelsState === 'stale' ||
        !isModelCacheFresh(w.modelsFetchedAt, WORKER_MODELS_TTL_MS)
      if (stale) {
        void refreshWorkerModels(w.id, undefined, { force: false }).catch((e) => {
          console.warn(`[workers-health] model cache refresh failed for ${w.name}`, e)
        })
      }
    }
  }, modelsRefreshMs)
  modelsTimer.unref?.()
}
