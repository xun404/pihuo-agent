/**
 * Mutations that require recycling the API child (env inject / provider wiring).
 * `disabledProviderIds` is intentionally omitted: enable switches only touch that
 * list and Desktop reloads settings without a process restart.
 */
const API_RESTART_KEYS = [
  'leaderModel',
  'thinkingIntensity',
  'leaderMaxSteps',
  'secrets',
  'customProviders',
] as const

export function settingsMutationRequiresApiRestart(payload: object): boolean {
  return API_RESTART_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key))
}
