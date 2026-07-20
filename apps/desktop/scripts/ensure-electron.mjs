/**
 * Ensure the platform Electron binary exists (electron@43 has no postinstall —
 * the binary is downloaded lazily on first require('electron')).
 *
 * CI Windows was hanging mid-vite-build on that lazy download (~1h until job timeout).
 * Call this explicitly after npm ci and before ELECTRON vite builds.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)

function packageDir() {
  try {
    return dirname(require.resolve('electron/package.json'))
  } catch {
    throw new Error(
      'Electron package is missing; run npm install before starting the desktop client',
    )
  }
}

function installedElectronBinary() {
  const dir = packageDir()
  const pathFile = join(dir, 'path.txt')
  if (!existsSync(pathFile)) return null
  const rel = readFileSync(pathFile, 'utf8').trim()
  if (!rel) return null
  const full = join(dir, 'dist', rel)
  return existsSync(full) ? full : null
}

function electronVersion() {
  try {
    return require('electron/package.json').version
  } catch {
    return 'unknown'
  }
}

const existing = installedElectronBinary()
if (existing) {
  console.log(
    `[desktop] Electron ${electronVersion()} ready (${process.platform}/${process.arch}): ${existing}`,
  )
  process.exit(0)
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
