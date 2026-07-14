/**
 * Worker health batch/single helpers used by HTTP API.
 */
import {
  applyHealthReport,
  parseHealthDepth,
  probeWorkerHealth,
  type ProbeDepth,
} from '@router-agents/adapters'
import {
  globalActivityLog,
  getSharedStore,
} from '@router-agents/core'
import type { WorkerHealthReport, WorkerRegistration } from '@router-agents/shared'

const store = getSharedStore()

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
  store.upsertWorker(updated)
  globalActivityLog.append(
    'system',
    `Worker health ${updated.name}: ${report.status}`,
    {
      workerId: updated.id,
      status: report.status,
      level: report.level,
      message: report.message,
    },
  )
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
  let list = store.listWorkers()
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
  const ttl = Number(process.env.WORKER_HEALTH_TTL_MS ?? 300_000) || 300_000

  const run = () => {
    void checkWorkersBatch({ depth: 'version', onlyEnabled: true }).catch((e) => {
      console.warn('[workers-health] auto check failed', e)
    })
  }

  // Don't block server listen
  setTimeout(run, 800)
  setInterval(run, ttl)

  // Soft auto-detect once shortly after boot (enable installed CLIs)
  setTimeout(() => {
    void (async () => {
      try {
        const { detectAcpWorkers, applyDetectionToWorkers } = await import(
          '@router-agents/adapters'
        )
        const { createId } = await import('@router-agents/core')
        const candidates = await detectAcpWorkers()
        const existing = store.listWorkers()
        // First boot: many unknown workers — apply detection
        const neverProbed = existing.every((w) => !w.lastSeenAt)
        if (!neverProbed && candidates.every((c) => !c.installed)) return

        const merged = applyDetectionToWorkers(existing, candidates, {
          createMissing: true,
          autoDisableMissing: false,
        })
        for (const w of merged.workers) {
          if (w.id.startsWith('detect-')) {
            store.upsertWorker({ ...w, id: createId('worker') })
          } else {
            store.upsertWorker(w)
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
}
