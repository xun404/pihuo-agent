import { BrowserWindow, Notification } from 'electron'
import {
  claimNotification,
  normalizeNotificationPayload,
  __clearClaimsForTest,
  type NativeNotificationPayload,
} from './notification-utils.js'

export { claimNotification, normalizeNotificationPayload, __clearClaimsForTest }
export type { NativeNotificationPayload }

const ACTIVE_NOTIFICATIONS = new Set<Notification>()

export function showNativeNotification(
  payload: NativeNotificationPayload,
  deps: { getMainWindow: () => BrowserWindow | null },
): boolean {
  if (!Notification.isSupported()) return false
  if (!claimNotification(payload.id)) return false

  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    silent: false,
    ...(process.platform === 'darwin' ? { sound: 'Glass' } : {}),
  })

  ACTIVE_NOTIFICATIONS.add(notification)
  const release = () => {
    ACTIVE_NOTIFICATIONS.delete(notification)
  }

  notification.on('click', () => {
    const mainWindow = deps.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    if (payload.sessionId) {
      deps.getMainWindow()?.webContents.send('app:open-session', { sessionId: payload.sessionId })
    }
    release()
  })
  notification.on('close', release)
  notification.on('failed', release)

  notification.show()
  return true
}
