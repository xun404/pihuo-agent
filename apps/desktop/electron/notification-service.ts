import { BrowserWindow, Notification } from 'electron'

export type NativeNotificationPayload = {
  id: string
  title: string
  body: string
  sessionId?: string
}

const ACTIVE_NOTIFICATIONS = new Set<Notification>()
const CLAIMS = new Map<string, number>()
const DEDUPE_TTL_MS = 5000

export function normalizeNotificationPayload(raw: unknown): NativeNotificationPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (!id || !title) return null
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
  return {
    id,
    title,
    body: typeof record.body === 'string' ? record.body : '',
    ...(sessionId ? { sessionId } : {}),
  }
}

export function claimNotification(id: string): boolean {
  if (!id) return true
  const now = Date.now()
  for (const [key, claimedAt] of CLAIMS) {
    if (now - claimedAt > DEDUPE_TTL_MS) CLAIMS.delete(key)
  }
  const claimedAt = CLAIMS.get(id) ?? 0
  if (now - claimedAt < DEDUPE_TTL_MS) return false
  CLAIMS.set(id, now)
  return true
}

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

export function __clearClaimsForTest(): void {
  CLAIMS.clear()
}
