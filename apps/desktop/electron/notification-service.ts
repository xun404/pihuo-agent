import { BrowserWindow, Notification } from 'electron'
import {
  claimNotification,
  normalizeNotificationPayload,
  __clearClaimsForTest,
  type NativeNotificationPayload,
} from './notification-utils.js'

export { claimNotification, normalizeNotificationPayload, __clearClaimsForTest }
export type { NativeNotificationPayload }

/**
 * Keep live references to shown notifications. On macOS a notification whose
 * JS reference is dropped stops firing click/close events after ~1 minute,
 * so we hold every instance until it closes or fails.
 */
const ACTIVE_NOTIFICATIONS = new Set<Notification>()

/**
 * Show a native OS notification from the main process.
 *
 * Delivery order: capability check → 5s dedupe → show → register click/close
 * handlers. Click focuses the main window (restoring if minimized) and, when a
 * sessionId was carried, asks the renderer to open that session via
 * `app:open-session`. macOS banners play the system 'Glass' sound; other
 * platforms keep the OS default.
 */
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
    // Resolve the window once: the window could be destroyed between the
    // focus sequence and the webContents.send, so guard both with the same
    // captured reference.
    const mainWindow = deps.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      if (payload.sessionId) {
        mainWindow.webContents.send('app:open-session', { sessionId: payload.sessionId })
      }
    }
    release()
  })
  notification.on('close', release)
  notification.on('failed', release)

  notification.show()
  return true
}
