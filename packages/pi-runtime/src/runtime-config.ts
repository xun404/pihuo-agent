const DEFAULT_HTTP_PORT = 4111
const DEFAULT_MEMORY_LAST_MESSAGES = 40
const DEFAULT_GOAL_MAX_RUNS = 30

function resolveBoundedPositiveInteger(raw: unknown, fallback: number, maximum: number): number {
  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.min(Math.floor(numeric), maximum)
}

export function resolveHttpPort(
  raw: unknown = process.env.PIHUO_AGENT_API_PORT ?? process.env.MASTRA_PORT,
  fallback = DEFAULT_HTTP_PORT,
): number {
  const numeric = Number(raw)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65_535) return fallback
  return numeric
}

export function resolveMemoryLastMessages(raw: unknown = process.env.MASTRA_LAST_MESSAGES): number {
  return resolveBoundedPositiveInteger(raw, DEFAULT_MEMORY_LAST_MESSAGES, 10_000)
}

export function resolveGoalMaxRuns(raw: unknown = process.env.GOAL_MAX_RUNS): number {
  return resolveBoundedPositiveInteger(raw, DEFAULT_GOAL_MAX_RUNS, 1_000)
}
