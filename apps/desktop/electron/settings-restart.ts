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
