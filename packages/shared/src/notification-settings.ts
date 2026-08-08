export type NotificationMode = 'always' | 'hidden-only'

export interface NotificationSettings {
  /** Master toggle: any native OS notification. */
  enabled: boolean
  /** 'always' = notify even while the window is focused; 'hidden-only' = only when unfocused. */
  mode: NotificationMode
  /** Session completion (green lamp event). */
  onCompletion: boolean
  /** Session failure / timeout (red lamp event). */
  onError: boolean
  /** Pending approval needs user action. */
  onApproval: boolean
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  mode: 'hidden-only',
  onCompletion: true,
  onError: true,
  onApproval: true,
}

export function isNotificationMode(raw: unknown): raw is NotificationMode {
  return raw === 'always' || raw === 'hidden-only'
}
