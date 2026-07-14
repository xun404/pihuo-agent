export const DEFAULT_LEADER_MAX_STEPS = 500
export const MIN_LEADER_MAX_STEPS = 10
export const MAX_LEADER_MAX_STEPS = 1000

export function resolveLeaderMaxSteps(value: unknown, fallback?: number): number {
  const fb = fallback ?? DEFAULT_LEADER_MAX_STEPS
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return fb
  }
  if (value < MIN_LEADER_MAX_STEPS || value > MAX_LEADER_MAX_STEPS) {
    return fb
  }
  return value
}

export function parseLeaderMaxStepsInput(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < MIN_LEADER_MAX_STEPS ||
    value > MAX_LEADER_MAX_STEPS
  ) {
    throw new RangeError(
      `leaderMaxSteps must be an integer between ${MIN_LEADER_MAX_STEPS} and ${MAX_LEADER_MAX_STEPS}`,
    )
  }
  return value
}
