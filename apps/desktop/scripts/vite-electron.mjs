/**
 * Run Vite with ELECTRON=1 in a platform-portable way.
 * Unix `ELECTRON=1 vite …` does not work under Windows cmd/pwsh npm scripts.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
// vite's package "exports" omit bin/vite.js — resolve via package root.
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
const args = process.argv.slice(2)

const result = spawnSync(process.execPath, [viteBin, ...args], {
  cwd: desktopRoot,
  env: { ...process.env, ELECTRON: '1' },
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status === null ? 1 : result.status)
