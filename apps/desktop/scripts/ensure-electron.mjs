/**
 * Ensure the platform Electron binary exists (electron@43 has no postinstall —
 * the binary is downloaded lazily on first require('electron')).
 *
 * Brands the local Electron runtime for macOS so Dock / menu bar / AltTab show
 * "SwarmDesk" instead of "Electron":
 *   - rename Electron.app → SwarmDesk.app
 *   - patch CFBundleName / CFBundleDisplayName
 *   - replace electron.icns with build/icon.icns
 *   - rewrite path.txt so require('electron') still resolves
 *
 * Call this after npm ci and before ELECTRON vite builds (`predesktop`).
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const APP_NAME = 'SwarmDesk'
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '../../..')

function packageDir() {
  try {
    return dirname(require.resolve('electron/package.json'))
  } catch {
    throw new Error(
      'Electron package is missing; run npm install before starting the desktop client',
    )
  }
}

function pathTxtFile() {
  return join(packageDir(), 'path.txt')
}

function installedElectronBinary() {
  const dir = packageDir()
  const pathFile = pathTxtFile()
  if (!existsSync(pathFile)) return null
  const rel = readFileSync(pathFile, 'utf8').trim()
  if (!rel) return null
  const underDist = join(dir, 'dist', rel)
  if (existsSync(underDist)) return underDist
  const full = join(dir, rel)
  return existsSync(full) ? full : null
}

function electronVersion() {
  try {
    return require('electron/package.json').version
  } catch {
    return 'unknown'
  }
}

function distDir() {
  return join(packageDir(), 'dist')
}

function electronAppCandidates() {
  const dist = distDir()
  return [join(dist, `${APP_NAME}.app`), join(dist, 'Electron.app')]
}

function resolveElectronAppRoot() {
  for (const p of electronAppCandidates()) {
    if (existsSync(p)) return p
  }
  return null
}

function setPlistString(plist, key, value) {
  let r = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], {
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    r = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist], {
      encoding: 'utf8',
    })
  }
  return r.status === 0
}

/**
 * macOS Dock / menu bar / app switcher brand the *bundle*, not app.setName().
 * Rename Electron.app → SwarmDesk.app and rebrand Info.plist + icon.
 */
function brandMacElectronApp() {
  if (process.platform !== 'darwin') return

  const dist = distDir()
  if (!existsSync(dist)) return

  const electronRoot = join(dist, 'Electron.app')
  const brandedRoot = join(dist, `${APP_NAME}.app`)

  /*
   * Prefer a single SwarmDesk.app bundle:
   * - Fresh install: Electron.app → rename
   * - Reinstall while branded exists: drop old branded, rename new Electron.app
   *   (npm may recreate Electron.app and reset path.txt)
   */
  if (existsSync(electronRoot)) {
    try {
      if (existsSync(brandedRoot)) {
        rmSync(brandedRoot, { recursive: true, force: true })
      }
      renameSync(electronRoot, brandedRoot)
      console.log(`[desktop] renamed Electron.app → ${APP_NAME}.app`)
    } catch (e) {
      console.warn(
        '[desktop] could not rename Electron.app (quit the desktop app first):',
        e instanceof Error ? e.message : e,
      )
    }
  }

  const appRoot = resolveElectronAppRoot()
  if (!appRoot) {
    console.warn('[desktop] no Electron/SwarmDesk.app found under electron/dist')
    return
  }

  // Keep require('electron') → path.txt in sync with the on-disk bundle name.
  const relBin = `${APP_NAME}.app/Contents/MacOS/Electron`
  const absBin = join(dist, relBin)
  if (existsSync(absBin)) {
    writeFileSync(pathTxtFile(), relBin, 'utf8')
  } else if (existsSync(join(dist, 'Electron.app/Contents/MacOS/Electron'))) {
    writeFileSync(pathTxtFile(), 'Electron.app/Contents/MacOS/Electron', 'utf8')
  }

  const plist = join(appRoot, 'Contents', 'Info.plist')
  if (existsSync(plist)) {
    setPlistString(plist, 'CFBundleName', APP_NAME)
    setPlistString(plist, 'CFBundleDisplayName', APP_NAME)
    // Some tools still read this; keep pointing at the icns we replace.
    setPlistString(plist, 'CFBundleIconFile', 'electron.icns')
  }

  const brandIcns = join(repoRoot, 'build', 'icon.icns')
  const electronIcns = join(appRoot, 'Contents', 'Resources', 'electron.icns')
  let iconOk = false
  if (existsSync(brandIcns) && existsSync(dirname(electronIcns))) {
    try {
      copyFileSync(brandIcns, electronIcns)
      iconOk = true
    } catch (e) {
      console.warn('[desktop] could not replace electron.icns:', e)
    }
  }

  // Refresh Launch Services / icon cache for this bundle (no Dock restart required).
  try {
    spawnSync(
      'touch',
      [appRoot, electronIcns].filter((p) => existsSync(p)),
    )
    const lsregister =
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
    if (existsSync(lsregister)) {
      spawnSync(lsregister, ['-f', appRoot], { encoding: 'utf8' })
    }
  } catch {
    /* ignore */
  }

  const name = existsSync(plist)
    ? spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleName', plist], {
        encoding: 'utf8',
      }).stdout?.trim()
    : '?'
  console.log(
    `[desktop] branded ${appRoot.split('/').pop()} → name=${name}` +
      (iconOk ? ', icon=build/icon.icns' : ''),
  )
}

function ensureBinary() {
  const existing = installedElectronBinary()
  if (existing) {
    console.log(
      `[desktop] Electron ${electronVersion()} ready (${process.platform}/${process.arch}): ${existing}`,
    )
    return existing
  }

  const dir = packageDir()
  console.warn(
    `[desktop] Electron ${electronVersion()} binary missing for ${process.platform}/${process.arch}; downloading via install.js ...`,
  )
  const started = Date.now()
  const result = spawnSync(process.execPath, [join(dir, 'install.js')], {
    cwd: dir,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Electron binary install failed (exit ${result.status}); check network/proxy and reinstall dependencies`,
    )
  }
  const binary = installedElectronBinary()
  if (!binary) {
    throw new Error(
      'Electron binary install reported success but the executable is still missing under node_modules/electron/dist',
    )
  }
  console.log(
    `[desktop] Electron downloaded in ${((Date.now() - started) / 1000).toFixed(1)}s: ${binary}`,
  )
  return binary
}

ensureBinary()
brandMacElectronApp()
