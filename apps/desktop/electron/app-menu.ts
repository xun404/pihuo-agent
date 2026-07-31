/**
 * Application menu bar for SwarmDesk.
 * About / Settings route into the renderer settings panel (not the OS about box).
 */
import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

export type SettingsTab = 'general' | 'model' | 'prompts' | 'workers' | 'about'

export type AppMenuOptions = {
  getMainWindow: () => BrowserWindow | null
  /** Ensure a BrowserWindow exists (create if needed). */
  ensureMainWindow?: () => void
  /** Tell the renderer to open Settings on a given tab. */
  openSettings: (tab: SettingsTab) => void
  homepageUrl?: string
}

/** When About is clicked before any window exists, hold the tab until load. */
let pendingSettingsTab: SettingsTab | null = null

export function consumePendingSettingsTab(): SettingsTab | null {
  const tab = pendingSettingsTab
  pendingSettingsTab = null
  return tab
}

function pushOpenSettings(win: BrowserWindow, tab: SettingsTab) {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send('app:open-settings', { tab })
  }
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function sendOpenSettings(
  getMainWindow: () => BrowserWindow | null,
  ensureMainWindow: (() => void) | undefined,
  tab: SettingsTab,
) {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    pendingSettingsTab = tab
    ensureMainWindow?.()
    app.emit('activate')
    return
  }
  pushOpenSettings(win, tab)
}

export function buildApplicationMenu(opts: AppMenuOptions): Menu {
  const { openSettings, homepageUrl = 'https://github.com/xun404/swarmdesk-agent' } = opts
  const isMac = process.platform === 'darwin'
  const name = app.name || 'SwarmDesk'

  const openAbout = () => openSettings('about')
  const openGeneral = () => openSettings('general')

  const macAppMenu: MenuItemConstructorOptions = {
    label: name,
    submenu: [
      {
        label: `About ${name}`,
        click: openAbout,
      },
      { type: 'separator' },
      {
        label: 'Settings…',
        accelerator: 'CmdOrCtrl+,',
        click: openGeneral,
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      ...(isMac
        ? []
        : ([
            {
              label: 'Settings…',
              accelerator: 'CmdOrCtrl+,',
              click: openGeneral,
            },
            { type: 'separator' as const },
          ] satisfies MenuItemConstructorOptions[])),
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  }

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? ([
            { role: 'pasteAndMatchStyle' as const },
            { role: 'delete' as const },
            { role: 'selectAll' as const },
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { role: 'delete' as const },
            { type: 'separator' as const },
            { role: 'selectAll' as const },
          ] satisfies MenuItemConstructorOptions[])),
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? ([
            { type: 'separator' as const },
            { role: 'front' as const },
          ] satisfies MenuItemConstructorOptions[])
        : ([{ role: 'close' as const }] satisfies MenuItemConstructorOptions[])),
    ],
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: `About ${name}`,
        click: openAbout,
      },
      {
        label: 'Documentation',
        click: () => {
          void shell.openExternal(homepageUrl)
        },
      },
      {
        label: 'Report an Issue',
        click: () => {
          void shell.openExternal(`${homepageUrl}/issues`)
        },
      },
    ],
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ]

  return Menu.buildFromTemplate(template)
}

/** Install the app menu and wire About/Settings to the renderer. */
export function installApplicationMenu(opts: {
  getMainWindow: () => BrowserWindow | null
  ensureMainWindow?: () => void
}): void {
  const openSettings = (tab: SettingsTab) =>
    sendOpenSettings(opts.getMainWindow, opts.ensureMainWindow, tab)
  const menu = buildApplicationMenu({
    getMainWindow: opts.getMainWindow,
    ensureMainWindow: opts.ensureMainWindow,
    openSettings,
  })
  Menu.setApplicationMenu(menu)
}

/** Call after a window finishes loading so a pending About/Settings click lands. */
export function flushPendingSettingsTab(win: BrowserWindow | null): void {
  const tab = consumePendingSettingsTab()
  if (!tab || !win || win.isDestroyed()) return
  pushOpenSettings(win, tab)
}
