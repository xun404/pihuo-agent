import { access, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { verifyRuntimeManifestContract } from '../../../scripts/release-contract.mjs'
import { verifyNodePtyRoundTrip } from './runtime-packaging.mjs'
import { resolvePackagedExecutable, resolvePackagedRuntimeDir } from './packaged-app-paths.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const releaseDir = resolve(repoRoot, 'release')
const executable = resolvePackagedExecutable({
  platform: process.platform,
  releaseDir,
  productName: 'SwarmDesk',
})
const runtimeDir = resolvePackagedRuntimeDir({
  platform: process.platform,
  releaseDir,
  productName: 'SwarmDesk',
})

async function findFreePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) reject(error)
        else resolvePort(port)
      })
    })
  })
}

const manifest = JSON.parse(await readFile(resolve(runtimeDir, 'runtime-manifest.json'), 'utf8'))
verifyRuntimeManifestContract(manifest)
if (
  !Array.isArray(manifest.stagedPackages) ||
  manifest.stagedPackages.length === 0 ||
  manifest.stagedPackages.some((name) => typeof name !== 'string')
) {
  throw new Error('Packaged runtime manifest has no staged package inventory')
}
await Promise.all([
  access(executable),
  access(resolve(runtimeDir, 'http-server.mjs')),
  ...manifest.stagedPackages.map((packageName) =>
    access(resolve(runtimeDir, 'node_modules', ...packageName.split('/'), 'package.json')),
  ),
])
const packagedRequire = createRequire(resolve(runtimeDir, 'packaged-smoke.cjs'))
const packagedPtyPath = packagedRequire.resolve('node-pty')
if (!packagedPtyPath.startsWith(resolve(runtimeDir, 'node_modules', 'node-pty'))) {
  throw new Error('Packaged node-pty resolved outside packaged runtime')
}
// win32 ConPTY AttachConsole is flaky under GHA; node-pty is already exercised by verify:runtime.
if (process.platform === 'win32') {
  console.log('Skipping packaged node-pty round-trip on win32 (covered by verify:runtime)')
} else {
  await verifyNodePtyRoundTrip({
    ptyModule: packagedRequire('node-pty'),
    cwd: runtimeDir,
    nodeExecutable: process.execPath,
  })
}
const port = process.env.MASTRA_PORT || String(await findFreePort())
// Linux CI runners cannot configure chrome-sandbox setuid (mode 4755 / root-owned).
// Without --no-sandbox Electron aborts with FATAL setuid_sandbox_host (exit 133).
const smokeArgs = ['--packaged-smoke']
if (process.platform === 'linux') smokeArgs.push('--no-sandbox')
const command = process.platform === 'linux' ? 'xvfb-run' : executable
const args = process.platform === 'linux' ? ['-a', executable, ...smokeArgs] : smokeArgs
const result = spawnSync(command, args, {
  cwd: repoRoot,
  env: {
    ...process.env,
    MASTRA_PORT: port,
    ELECTRON_ENABLE_LOGGING: '1',
  },
  stdio: 'inherit',
  shell: false,
  // If Electron fails to hard-exit after smoke, fail this step instead of hanging CI.
  timeout: 90_000,
  killSignal: 'SIGKILL',
})

if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`Packaged smoke failed with exit code ${result.status}`)
}
console.log(`Packaged desktop smoke passed on port ${port}`)
// Packaged Electron can leave open handles on Windows; exit explicitly.
process.exit(0)
