/**
 * Folder picker for Electron desktop.
 *
 * Order:
 * 1) Electron showOpenDialog attached to a temporary normal BrowserWindow
 *    (frameless parent / no-parent often returns empty filePaths on macOS)
 * 2) macOS: osascript choose folder via Finder (real system panel)
 * 3) Windows PowerShell / Linux zenity
 *
 * Never uses the HTML <input type=file> "upload" dialog (that is renderer-side).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dialog, app, BrowserWindow, type BrowserWindow as BW } from 'electron'

const execFileAsync = promisify(execFile)

export type PickDirectoryResult =
  { ok: true; path: string; via: string } | { ok: false; reason: string; via?: string }

export type PickDirectoryLabels = {
  title?: string
  buttonLabel?: string
  message?: string
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && (p.endsWith('/') || p.endsWith('\\'))) {
    return p.replace(/[/\\]+$/, '')
  }
  return p
}

async function pickElectronWithTempWindow(
  labels: PickDirectoryLabels,
): Promise<PickDirectoryResult> {
  let temp: BW | null = null
  try {
    // A tiny normal window as dialog parent — avoids empty filePaths with frameless main window
    temp = new BrowserWindow({
      width: 420,
      height: 280,
      show: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      resizable: false,
      title: labels.title?.trim() || '选择项目文件夹',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    // Must be shown (can be off-screen) for sheet dialogs on some macOS versions
    temp.setMenuBarVisibility(false)
    temp.center()
    temp.showInactive()

    await new Promise((r) => setTimeout(r, 50))

    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: labels.title?.trim() || '选择项目文件夹',
      buttonLabel: labels.buttonLabel?.trim() || '选择此文件夹',
      defaultPath: app.getPath('home'),
    }
    if (labels.message?.trim()) opts.message = labels.message.trim()

    const result = await dialog.showOpenDialog(temp, opts)
    console.log('[pick-directory] electron+tempWin', JSON.stringify(result))

    const paths = (Array.isArray(result.filePaths) ? result.filePaths : [])
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean)

    if (paths[0]) {
      return { ok: true, path: stripTrailingSlash(paths[0]!), via: 'electron-temp-window' }
    }
    if (result.canceled) {
      return { ok: false, reason: 'canceled', via: 'electron-temp-window' }
    }
    return { ok: false, reason: 'empty_selection', via: 'electron-temp-window' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[pick-directory] electron+tempWin failed', msg)
    return { ok: false, reason: msg, via: 'electron-temp-window' }
  } finally {
    try {
      if (temp && !temp.isDestroyed()) temp.destroy()
    } catch {
      /* ignore */
    }
  }
}

async function pickElectronDetached(labels: PickDirectoryLabels): Promise<PickDirectoryResult> {
  try {
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: labels.title?.trim() || '选择项目文件夹',
      buttonLabel: labels.buttonLabel?.trim() || '选择此文件夹',
      defaultPath: app.getPath('home'),
    }
    if (labels.message?.trim()) opts.message = labels.message.trim()

    const result = await dialog.showOpenDialog(opts)
    console.log('[pick-directory] electron-detached', JSON.stringify(result))

    const paths = (Array.isArray(result.filePaths) ? result.filePaths : [])
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean)

    if (paths[0]) return { ok: true, path: stripTrailingSlash(paths[0]!), via: 'electron-detached' }
    if (result.canceled) return { ok: false, reason: 'canceled', via: 'electron-detached' }
    return { ok: false, reason: 'empty_selection', via: 'electron-detached' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg, via: 'electron-detached' }
  }
}

async function pickMacOsascript(prompt: string): Promise<PickDirectoryResult> {
  // Activate Finder so the panel is visible and not auto-dismissed
  const script = `
tell application "Finder"
  activate
  try
    set theFolder to choose folder with prompt ${JSON.stringify(prompt)}
    return POSIX path of theFolder
  on error number -128
    return "__CANCELED__"
  on error errMsg
    return "__ERROR__:" & errMsg
  end try
end tell
`.trim()

  try {
    const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], {
      timeout: 600_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    })
    if (stderr?.trim()) console.warn('[pick-directory] osascript stderr', stderr.trim())
    const raw = (stdout || '').trim()
    if (!raw || raw === '__CANCELED__') {
      return { ok: false, reason: 'canceled', via: 'osascript' }
    }
    if (raw.startsWith('__ERROR__:')) {
      return { ok: false, reason: raw.slice('__ERROR__:'.length), via: 'osascript' }
    }
    const p = stripTrailingSlash(raw)
    if (!p) return { ok: false, reason: 'empty_selection', via: 'osascript' }
    return { ok: true, path: p, via: 'osascript' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/User canceled|(-128)/i.test(msg)) {
      return { ok: false, reason: 'canceled', via: 'osascript' }
    }
    console.error('[pick-directory] osascript failed', msg)
    return { ok: false, reason: msg, via: 'osascript' }
  }
}

async function pickWindowsPowershell(description: string): Promise<PickDirectoryResult> {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = ${JSON.stringify(description)}
$d.ShowNewFolderButton = $true
$r = $d.ShowDialog()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) } else { [Console]::Out.Write('__CANCELED__') }
`.trim()

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 600_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    const raw = (stdout || '').trim()
    if (!raw || raw === '__CANCELED__') {
      return { ok: false, reason: 'canceled', via: 'powershell' }
    }
    return { ok: true, path: stripTrailingSlash(raw), via: 'powershell' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg, via: 'powershell' }
  }
}

async function pickLinuxZenity(title: string): Promise<PickDirectoryResult> {
  try {
    const { stdout } = await execFileAsync(
      'zenity',
      ['--file-selection', '--directory', `--title=${title}`],
      { timeout: 600_000, maxBuffer: 1024 * 1024 },
    )
    const raw = (stdout || '').trim()
    if (!raw) return { ok: false, reason: 'canceled', via: 'zenity' }
    return { ok: true, path: stripTrailingSlash(raw), via: 'zenity' }
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code
    if (code === 1) return { ok: false, reason: 'canceled', via: 'zenity' }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg, via: 'zenity' }
  }
}

/**
 * Pick a project directory using the best available system UI.
 * Does not treat cancel as success; caller should surface feedback.
 */
export async function pickProjectDirectory(
  labels: PickDirectoryLabels = {},
  _parent: BrowserWindow | null = null,
): Promise<PickDirectoryResult> {
  const title = labels.title?.trim() || '选择项目文件夹'
  const prompt = labels.message?.trim() || title

  // 1) Electron dialog with temporary normal window (best chance of real paths)
  const e1 = await pickElectronWithTempWindow(labels)
  if (e1.ok) return e1
  // Real user cancel — stop (don't chain more dialogs)
  if (e1.reason === 'canceled') return e1

  // 2) Detached electron dialog
  const e2 = await pickElectronDetached(labels)
  if (e2.ok) return e2
  if (e2.reason === 'canceled') return e2

  // 3) Platform-native tools
  if (process.platform === 'darwin') {
    const r = await pickMacOsascript(prompt)
    if (r.ok || r.reason === 'canceled') return r
  } else if (process.platform === 'win32') {
    const r = await pickWindowsPowershell(prompt)
    if (r.ok || r.reason === 'canceled') return r
  } else {
    const r = await pickLinuxZenity(title)
    if (r.ok || r.reason === 'canceled') return r
  }

  // Return last electron failure for diagnostics
  return e2.reason !== 'canceled' ? e2 : e1
}
