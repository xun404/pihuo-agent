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
 * How long `showNativeNotification` waits for the OS to confirm a show before
 * declaring success. `show` fires promptly on macOS/Windows when the banner is
 * actually displayed; a stalled promise at this point is treated as shown
 * (optimistic) so callers don't double-report.
 */
const SHOW_CONFIRM_TIMEOUT_MS = 2000

/**
 * Show a native OS notification from the main process.
 *
 * Delivery order: capability check → 5s dedupe → show → await the OS show
 * confirmation. Resolves `true` once the banner is displayed, `false` when
 * the OS rejects it (e.g. macOS notification permission denied — the
 * UNUserNotificationCenter 'failed' event). Click focuses the main window
 * (restoring if minimized) and, when a sessionId was carried, asks the
 * renderer to open that session via `app:open-session`. macOS banners play
 * the system 'Glass' sound; other platforms keep the OS default.
 */
export function showNativeNotification(
  payload: NativeNotificationPayload,
  deps: { getMainWindow: () => BrowserWindow | null },
): Promise<boolean> {
  if (!Notification.isSupported()) return Promise.resolve(false)
  if (!claimNotification(payload.id)) return Promise.resolve(false)

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

  const outcome = new Promise<boolean>((resolve) => {
    let settled = false
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    const settle = (shown: boolean) => {
      if (settled) return
      settled = true
      if (fallbackTimer) clearTimeout(fallbackTimer)
      resolve(shown)
    }
    fallbackTimer = setTimeout(() => settle(true), SHOW_CONFIRM_TIMEOUT_MS)

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
    notification.on('show', () => settle(true))
    notification.on('failed', (event, error) => {
      const code =
        (error as { code?: unknown })?.code ??
        (event as { error?: { code?: unknown } })?.error?.code ??
        'unknown'
      const message =
        (error as { message?: string })?.message ??
        (event as { error?: { message?: string } })?.error?.message ??
        ''
      console.warn(
        `[notifications] show failed for id=${payload.id} (code=${String(code)}) ${message}`,
      )
      release()
      settle(false)
    })
  })

  notification.show()
  return outcome
}
