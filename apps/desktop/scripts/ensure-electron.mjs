import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)

function installedElectronBinary() {
  try {
    const binary = require('electron')
    return typeof binary === 'string' && existsSync(binary) ? binary : null
  } catch {
    return null
  }
}

if (!installedElectronBinary()) {
  let packageDir
  try {
    packageDir = dirname(require.resolve('electron/package.json'))
  } catch {
    throw new Error(
      'Electron package is missing; run npm install before starting the desktop client',
    )
  }

  console.warn('[desktop] Electron binary is missing; repairing the package installation...')
  const result = spawnSync(process.execPath, [join(packageDir, 'install.js')], {
    cwd: packageDir,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0 || !installedElectronBinary()) {
    throw new Error(
      'Electron binary repair failed; check network/proxy settings and reinstall dependencies',
    )
  }
}
