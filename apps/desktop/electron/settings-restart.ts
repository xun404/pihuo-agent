/**
 * Mutations that require recycling the API child (env inject / provider wiring).
 *
 * Runtime-live preferences are deliberately excluded: leaderModel,
 * thinkingIntensity, and leaderMaxSteps are re-resolved from loadSettings() on
 * every chat request (applySecretsToEnv also re-syncs their env mirrors), so a
 * restart would only delay the confirmation toast for several seconds. Provider
 * enable/disable stays out too — Desktop reloads settings without a restart.
 */
const API_RESTART_KEYS = ['secrets', 'customProviders'] as const

export function settingsMutationRequiresApiRestart(payload: object): boolean {
  return API_RESTART_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key))
}
