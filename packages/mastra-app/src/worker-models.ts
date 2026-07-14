import { listAcpModels, applyHealthReport, type ListAcpModelsResult } from '@router-agents/adapters'
import { getSharedStore } from '@router-agents/core'
import type { WorkerRegistration } from '@router-agents/shared'

export interface RefreshModelsResult {
  ok: boolean
  models: WorkerRegistration['availableModels']
  error?: string
  worker: WorkerRegistration
  cached: boolean
  stale: boolean
}

export async function refreshWorkerModels(
  workerId: string,
  cwd?: string,
): Promise<RefreshModelsResult> {
  const store = getSharedStore()
  const worker = store.listWorkers().find((w) => w.id === workerId)
  if (!worker) throw new Error(`Worker not found: ${workerId}`)

  const checkedAt = new Date().toISOString()
  const result = await listAcpModels(worker, { cwd, timeoutMs: 90000 })
  const hadCache = Boolean(worker.availableModels?.length)

  if (result.ok && result.models.length > 0) {
    store.upsertWorker(
      applyHealthReport(
        {
          ...worker,
          availableModels: result.models,
          modelsFetchedAt: checkedAt,
          modelsState: 'fresh' as const,
          modelsError: undefined,
        },
        {
          status: 'healthy',
          level: 'acp_handshake',
          checkedAt,
          message: `ACP 可用 · ${result.models.length} 个模型 (configOptions)`,
          hints: [],
        },
      ),
    )
    const updated = store.listWorkers().find((w) => w.id === workerId) ?? worker
    return {
      ok: true,
      models: result.models,
      worker: updated,
      cached: false,
      stale: false,
    }
  }

  if (!result.ok && hadCache) {
    const staleWorker = store.setWorkerModelsStale(workerId, result.error ?? 'Model refresh failed')
    store.upsertWorker(
      applyHealthReport(staleWorker, {
        status: 'unhealthy',
        level: 'acp_handshake',
        checkedAt,
        message: result.error ?? 'ACP 模型列表不可用',
        hints: ['可稍后重试「更新模型列表」', '或手动填写 model id'],
        detail: { errorCode: 'ACP_MODELS' },
      }),
    )
    const updated = store.listWorkers().find((w) => w.id === workerId) ?? worker
    return {
      ok: false,
      models: worker.availableModels ?? [],
      error: result.error,
      worker: updated,
      cached: true,
      stale: true,
    }
  }

  const staleWorker2 = store.setWorkerModelsStale(workerId, result.error ?? 'No models available')
  store.upsertWorker(
    applyHealthReport(staleWorker2, {
      status: 'unhealthy',
      level: 'acp_handshake',
      checkedAt,
      message: result.error ?? 'ACP 模型列表不可用',
      hints: ['可稍后重试「更新模型列表」', '或手动填写 model id'],
      detail: { errorCode: 'ACP_MODELS' },
    }),
  )
  const updated = store.listWorkers().find((w) => w.id === workerId) ?? worker
  return {
    ok: false,
    models: [],
    error: result.error ?? 'Model refresh failed',
    worker: updated,
    cached: false,
    stale: true,
  }
}
