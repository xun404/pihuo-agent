import { createRequire } from 'node:module'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  currentLibcFamily,
  isLoadedLibsqlModule,
  isLoadedNodePtyModule,
  requiredRuntimePackageNames,
  resolveLibsqlNativePackage,
  unstagedRuntimeImportSpecifiers,
  verifyNodePtyRoundTrip,
} from './runtime-packaging.mjs'
import { verifyRuntimeManifestContract } from '../../../scripts/release-contract.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const runtimeDir = resolve(repoRoot, 'apps/desktop/dist-runtime')
const bundlePath = resolve(runtimeDir, 'http-server.mjs')
const manifestPath = resolve(runtimeDir, 'runtime-manifest.json')
const sourceMapPath = `${bundlePath}.map`
const bundledRegistryVerifierPath = resolve(runtimeDir, 'verify-bundled-registry.mjs')

await Promise.all([
  access(bundlePath),
  access(sourceMapPath),
  access(manifestPath),
  access(bundledRegistryVerifierPath),
  access(`${bundledRegistryVerifierPath}.map`),
])

const [source, manifestSource, packageSource] = await Promise.all([
  readFile(bundlePath, 'utf8'),
  readFile(manifestPath, 'utf8'),
  readFile(resolve(repoRoot, 'package.json'), 'utf8'),
])
const manifest = JSON.parse(manifestSource)
const packageJson = JSON.parse(packageSource)
const target = {
  platform: process.platform,
  arch: process.arch,
  libcFamily: currentLibcFamily(),
}
const expectedNativePackage = resolveLibsqlNativePackage(
  target.platform,
  target.arch,
  target.libcFamily,
)

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Runtime version ${manifest.version} does not match package ${packageJson.version}`,
  )
}
if (
  manifest.platform !== target.platform ||
  manifest.arch !== target.arch ||
  manifest.nativePackage !== expectedNativePackage
) {
  throw new Error('Runtime manifest does not match the current build target')
}
verifyRuntimeManifestContract(manifest)

const isolatedCwd = await mkdtemp(resolve(tmpdir(), 'router-runtime-verify-'))
try {
  const verifierScript = [
    `const module = await import(${JSON.stringify(pathToFileURL(bundledRegistryVerifierPath).href)})`,
    'process.stdout.write(JSON.stringify(module.verifyBundledRegistryRuntime()))',
  ].join(';')
  const verified = spawnSync(process.execPath, ['--input-type=module', '-e', verifierScript], {
    cwd: isolatedCwd,
    encoding: 'utf8',
    shell: false,
  })
  if (verified.error) throw verified.error
  if (verified.status !== 0) {
    throw new Error('Bundled Registry verifier failed outside repository cwd')
  }
  const facts = JSON.parse(verified.stdout)
  if (JSON.stringify(facts) !== JSON.stringify(manifest.bundledRegistry)) {
    throw new Error('Bundled Registry runtime facts do not match runtime manifest')
  }
} finally {
  await rm(isolatedCwd, { recursive: true, force: true })
}

const importSpecifiers = manifest.externalImports
if (
  !Array.isArray(importSpecifiers) ||
  importSpecifiers.some((specifier) => typeof specifier !== 'string')
) {
  throw new Error('Runtime manifest is missing its external import inventory')
}
if (importSpecifiers.some((specifier) => extname(specifier) === '.ts')) {
  throw new Error('Desktop API runtime contains a TypeScript import')
}
if (importSpecifiers.some((specifier) => specifier.startsWith('@pihuo-agent/'))) {
  throw new Error('Desktop API runtime contains a source workspace import')
}

const stagedPackageNames = requiredRuntimePackageNames(target)
const unstagedImports = unstagedRuntimeImportSpecifiers(importSpecifiers, stagedPackageNames)
if (unstagedImports.length > 0) {
  throw new Error(`Desktop API runtime imports unstaged packages: ${unstagedImports.join(', ')}`)
}

for (const packageName of stagedPackageNames) {
  await access(resolve(runtimeDir, 'node_modules', ...packageName.split('/')))
}

const runtimeRequire = createRequire(resolve(runtimeDir, 'verify-runtime.cjs'))
const nodePtyResolved = runtimeRequire.resolve('node-pty')
if (!nodePtyResolved.startsWith(resolve(runtimeDir, 'node_modules', 'node-pty'))) {
  throw new Error('Staged node-pty resolved outside dist-runtime')
}
const loaded = runtimeRequire('libsql')
if (!isLoadedLibsqlModule(loaded)) {
  throw new Error('Staged libsql package did not load its native module')
}
const nodePty = runtimeRequire('node-pty')
if (!isLoadedNodePtyModule(nodePty)) {
  throw new Error('Staged node-pty package did not load its native module')
}
await verifyNodePtyRoundTrip({
  ptyModule: nodePty,
  cwd: runtimeDir,
  nodeExecutable: process.execPath,
})

console.log(
  `Desktop API runtime verified for ${target.platform}-${target.arch} (${expectedNativePackage})`,
)
// Fail closed if a native handle keeps the event loop alive (Windows ConPTY).
process.exit(0)
