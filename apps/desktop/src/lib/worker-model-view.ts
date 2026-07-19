export interface WorkerModelViewOption {
  modelId: string
  name: string
  description?: string
}

export function resolveWorkerModelOptions(
  query: string,
  searchResults: WorkerModelViewOption[] | undefined,
  scopedCatalog: WorkerModelViewOption[] | undefined,
  fallbackCatalog: WorkerModelViewOption[],
  allowFallbackCatalog = true,
): WorkerModelViewOption[] {
  if (query.trim() && searchResults) return searchResults
  return scopedCatalog ?? (allowFallbackCatalog ? fallbackCatalog : [])
}

export function shouldApplyScopedModelResponse(
  requestProjectId: string | null,
  currentProjectId: string | null,
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestProjectId === currentProjectId && requestGeneration === currentGeneration
}
