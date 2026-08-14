import type { WorkerEventWriter } from '../worker-events.js'

export type LeaderRunContext = {
  routerSessionId: string
  routerProjectId: string
  routerProjectRoot?: string
  memoryThreadId: string
  writer?: WorkerEventWriter
}

export function requestContextFromRun(run: LeaderRunContext) {
  const values: Record<string, unknown> = {
    routerSessionId: run.routerSessionId,
    routerProjectId: run.routerProjectId,
    routerProjectRoot: run.routerProjectRoot,
    memoryThreadId: run.memoryThreadId,
  }
  return {
    get(key: string) {
      return values[key]
    },
  }
}
