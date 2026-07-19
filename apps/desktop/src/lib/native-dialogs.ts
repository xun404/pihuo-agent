/**
 * Desktop-native dialogs via Electron IPC.
 * Uses OS folder picker (button: 选择此文件夹), not the HTML "upload" file dialog.
 */

export type DirectoryPickOk = { ok: true; path: string; via?: string }
export type DirectoryPickFail = { ok: false; reason: string; raw?: unknown; via?: string }
export type DirectoryPickResult = DirectoryPickOk | DirectoryPickFail

export type OpenDirectoryLabels = {
  title?: string
  buttonLabel?: string
  message?: string
}

/**
 * Normalize whatever the main-process IPC returns into a single path string.
 */
export function pathFromOpenDirectoryResult(result: unknown): string | null {
  if (result == null) return null

  if (typeof result === 'string') {
    const trimmed = result.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (Array.isArray(result)) {
    const first = result.find((x) => typeof x === 'string' && x.trim())
    return typeof first === 'string' ? first.trim() : null
  }

  if (typeof result === 'object') {
    const obj = result as {
      ok?: unknown
      path?: unknown
      filePaths?: unknown
      filePath?: unknown
    }

    if (obj.ok === true && typeof obj.path === 'string' && obj.path.trim()) {
      return obj.path.trim()
    }
    if (obj.ok === false) return null

    if (typeof obj.path === 'string' && obj.path.trim()) return obj.path.trim()
    if (typeof obj.filePath === 'string' && obj.filePath.trim()) return obj.filePath.trim()
    if (Array.isArray(obj.filePaths)) {
      const first = obj.filePaths.find((x) => typeof x === 'string' && String(x).trim())
      if (typeof first === 'string' && first.trim()) return first.trim()
    }
  }

  return null
}

export function failReasonFromOpenDirectoryResult(result: unknown): string {
  if (result == null) return 'null_result'
  if (typeof result === 'object' && result !== null && 'reason' in result) {
    const r = (result as { reason?: unknown }).reason
    if (typeof r === 'string' && r.trim()) return r
  }
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    const o = result as { ok?: unknown }
    if (o.ok === false) return 'ok_false'
  }
  return 'unparseable'
}

export function hasNativeDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.routerAgents?.dialog?.openDirectory === 'function'
  )
}

export function hasNativeConfirm(): boolean {
  return typeof window !== 'undefined' && typeof window.routerAgents?.dialog?.confirm === 'function'
}

export async function pickProjectDirectory(labels?: OpenDirectoryLabels): Promise<string | null> {
  const detailed = await pickProjectDirectoryDetailed(labels)
  return detailed.ok ? detailed.path : null
}

export async function pickProjectDirectoryDetailed(
  labels?: OpenDirectoryLabels,
): Promise<DirectoryPickResult> {
  if (!hasNativeDirectoryPicker()) {
    return { ok: false, reason: 'no_native_picker' }
  }
  try {
    const raw: unknown = await window.routerAgents!.dialog!.openDirectory(labels)
    console.log('[pickProjectDirectory] raw IPC result', raw)
    const path = pathFromOpenDirectoryResult(raw)
    const via =
      raw && typeof raw === 'object' && raw !== null && 'via' in raw
        ? String((raw as { via?: unknown }).via ?? '')
        : undefined
    if (path) return { ok: true, path, via: via || undefined }
    return {
      ok: false,
      reason: failReasonFromOpenDirectoryResult(raw),
      raw,
      via: via || undefined,
    }
  } catch (e) {
    console.error('[pickProjectDirectory]', e)
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function confirmAction(message: string): Promise<boolean> {
  if (hasNativeConfirm()) {
    return window.routerAgents!.dialog!.confirm(message)
  }
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(message)
  }
  return false
}
