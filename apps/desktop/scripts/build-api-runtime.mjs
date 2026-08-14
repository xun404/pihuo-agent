import { build } from 'esbuild'
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  currentLibcFamily,
  resolveLibsqlNativePackage,
  runtimeExternalPackageNames,
  stageRuntimePackages,
} from './runtime-packaging.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const runtimeDir = resolve(repoRoot, 'apps/desktop/dist-runtime')
const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'))
const target = {
  platform: process.platform,
  arch: process.arch,
  libcFamily: currentLibcFamily(),
}

await rm(runtimeDir, { recursive: true, force: true })
await mkdir(runtimeDir, { recursive: true })

const buildResult = await build({
  entryPoints: [resolve(repoRoot, 'packages/pi-runtime/src/http-server.ts')],
  outfile: resolve(runtimeDir, 'http-server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  metafile: true,
  packages: 'bundle',
  external: runtimeExternalPackageNames(target),
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
})
const bundledRegistryVerifierPath = resolve(runtimeDir, 'verify-bundled-registry.mjs')
const bundledRegistryBuildResult = await build({
  stdin: {
    contents: [
      "import { verifyBundledAcpRegistryArtifacts } from './packages/adapters/src/acp-registry-bundled.ts'",
      'export function verifyBundledRegistryRuntime() {',
      '  return verifyBundledAcpRegistryArtifacts()',
      '}',
    ].join('\n'),
    resolveDir: repoRoot,
    sourcefile: 'verify-bundled-registry-runtime.ts',
  },
  outfile: bundledRegistryVerifierPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  metafile: true,
  packages: 'bundle',
})
const externalImports = [
  ...new Set(
    Object.values(buildResult.metafile.outputs)
      .flatMap((output) => output.imports)
      .filter((entry) => entry.external)
      .map((entry) => entry.path),
  ),
].sort()
const bundledRegistryExternalImports = [
  ...new Set(
    Object.values(bundledRegistryBuildResult.metafile.outputs)
      .flatMap((output) => output.imports)
      .filter((entry) => entry.external)
      .map((entry) => entry.path),
  ),
].sort()
const bundledRegistryModule = await import(
  `${pathToFileURL(bundledRegistryVerifierPath).href}?built=${Date.now()}`
)
const bundledRegistry = bundledRegistryModule.verifyBundledRegistryRuntime()

const stagedPackages = await stageRuntimePackages({
  outputDir: runtimeDir,
  target,
})
const nativePackage = resolveLibsqlNativePackage(target.platform, target.arch, target.libcFamily)
const nodePtyPackage = JSON.parse(
  await readFile(resolve(repoRoot, 'node_modules/node-pty/package.json'), 'utf8'),
)
await writeFile(
  resolve(runtimeDir, 'runtime-manifest.json'),
  `${JSON.stringify(
    {
      version: packageJson.version,
      platform: target.platform,
      arch: target.arch,
      libcFamily: target.libcFamily ?? null,
      nativePackage,
      nativePackages: {
        libsql: nativePackage,
        pty: 'node-pty',
      },
      ptyVersion: nodePtyPackage.version,
      bundledRegistryVerifier: 'verify-bundled-registry.mjs',
      bundledRegistry,
      bundledRegistryExternalImports,
      stagedPackages,
      externalImports,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)

console.log(`Desktop API runtime built for ${target.platform}-${target.arch} at ${runtimeDir}`)
