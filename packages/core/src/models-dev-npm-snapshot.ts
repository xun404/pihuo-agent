/**
 * Hot-install @opencode-ai/models (latest) via configured npm registry and
 * write its official snapshot into the models.dev LKG (api.json + meta.json).
 *
 * Used when https://models.dev/api.json is unreachable (e.g. mainland CN).
 * Snapshot data is still models.dev official catalog, shipped via npm.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { resolveRouterDataPaths } from './router-data-paths.js'
import {
  modelsDevCatalogPaths,
  type ModelsDevCatalogPaths,
  type ModelsDevProviderRaw,
  type RefreshModelsDevResult,
} from './models-dev-catalog.js'

const execFileAsync = promisify(execFile)

export const MODELS_DEV_NPM_PACKAGE = '@opencode-ai/models'
/** Locked package name — never take package name from user input. */
const PACKAGE_SPEC_LATEST = `${MODELS_DEV_NPM_PACKAGE}@latest`

export type ModelsDevNpmSnapshotResult = RefreshModelsDevResult & {
  packageVersion: string
  generatedAt?: string
  via: 'npm-snapshot'
}

export type InstallModelsDevNpmSnapshotOptions = {
  /** https registry from settings.npmRegistry; empty → system default */
  registry?: string
  paths?: ModelsDevCatalogPaths
  /** Install prefix under cache (default: <cache>/npm-models-dev) */
  prefixDir?: string
  /** Absolute path to npm CLI or `npm` on PATH */
  npmCommand?: string
  /** node binary when npm is a .js CLI */
  nodeCommand?: string
  timeoutMs?: number
  execFileImpl?: typeof execFileAsync
}

function defaultPrefixDir(): string {
  return join(resolveRouterDataPaths().cacheDir, 'npm-models-dev')
}

function packageRoot(prefixDir: string): string {
  return join(prefixDir, 'node_modules', ...MODELS_DEV_NPM_PACKAGE.split('/'))
}

function readInstalledVersion(prefixDir: string): string | null {
  try {
    const pkgJson = join(packageRoot(prefixDir), 'package.json')
    if (!existsSync(pkgJson)) return null
    const j = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version?: string }
    return typeof j.version === 'string' ? j.version : null
  } catch {
    return null
  }
}

function buildNpmEnv(registry?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const reg = registry?.trim()
  if (reg) {
    env.NPM_CONFIG_REGISTRY = reg
    // Avoid picking up a user .npmrc that overrides registry for this install.
    env.npm_config_registry = reg
  }
  return env
}

/**
 * Resolve how to invoke npm: either `npm` on PATH or `node /path/to/npm-cli.js`.
 */
export function resolveNpmInvoke(
  npmCommand = 'npm',
  nodeCommand = process.execPath,
): { command: string; baseArgs: string[] } {
  if (npmCommand.endsWith('.js') || npmCommand.endsWith('npm-cli.js')) {
    return { command: nodeCommand, baseArgs: [npmCommand] }
  }
  return { command: npmCommand, baseArgs: [] }
}

async function runNpm(
  args: string[],
  opts: {
    cwd: string
    registry?: string
    npmCommand?: string
    nodeCommand?: string
    timeoutMs?: number
    execFileImpl?: typeof execFileAsync
  },
): Promise<{ stdout: string; stderr: string }> {
  const exec = opts.execFileImpl ?? execFileAsync
  const { command, baseArgs } = resolveNpmInvoke(opts.npmCommand ?? 'npm', opts.nodeCommand)
  const fullArgs = [...baseArgs, ...args]
  try {
    const { stdout, stderr } = await exec(command, fullArgs, {
      cwd: opts.cwd,
      env: buildNpmEnv(opts.registry),
      timeout: opts.timeoutMs ?? 180_000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    })
    return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: string | number }
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n').trim()
    throw new Error(
      `npm ${args.slice(0, 3).join(' ')} failed${opts.registry ? ` (registry ${opts.registry})` : ''}: ${detail.slice(0, 800)}`,
      { cause: err },
    )
  }
}

/**
 * Install/update @opencode-ai/models@latest under a private prefix and apply snapshot to LKG.
 */
export async function installAndApplyModelsDevNpmSnapshot(
  opts: InstallModelsDevNpmSnapshotOptions = {},
): Promise<ModelsDevNpmSnapshotResult> {
  const paths = opts.paths ?? modelsDevCatalogPaths()
  const prefixDir = opts.prefixDir ?? defaultPrefixDir()
  mkdirSync(prefixDir, { recursive: true, mode: 0o700 })

  // Minimal package.json so npm install --prefix works without polluting user project.
  const marker = join(prefixDir, 'package.json')
  if (!existsSync(marker)) {
    writeFileSync(
      marker,
      JSON.stringify(
        {
          name: 'pihuo-agent-models-dev-npm-cache',
          private: true,
          description: 'Hot-install cache for @opencode-ai/models snapshot (models.dev official)',
        },
        null,
        2,
      ),
      { encoding: 'utf8', mode: 0o600 },
    )
  }

  await runNpm(
    [
      'install',
      PACKAGE_SPEC_LATEST,
      '--no-fund',
      '--no-audit',
      '--no-update-notifier',
      '--prefer-online',
    ],
    {
      cwd: prefixDir,
      registry: opts.registry,
      npmCommand: opts.npmCommand,
      nodeCommand: opts.nodeCommand,
      timeoutMs: opts.timeoutMs ?? 180_000,
      execFileImpl: opts.execFileImpl,
    },
  )

  const packageVersion = readInstalledVersion(prefixDir)
  if (!packageVersion) {
    throw new Error(`installed ${MODELS_DEV_NPM_PACKAGE} but package.json version is missing`)
  }

  const snapshotJs = join(packageRoot(prefixDir), 'dist', 'snapshot.js')
  if (!existsSync(snapshotJs)) {
    throw new Error(
      `${MODELS_DEV_NPM_PACKAGE}@${packageVersion} missing dist/snapshot.js (corrupt install?)`,
    )
  }

  // Bust import cache so re-install of a newer version is visible in the same process.
  const href = `${pathToFileURL(snapshotJs).href}?t=${Date.now()}`
  const snap = (await import(href)) as {
    providers?: Record<string, ModelsDevProviderRaw>
    generatedAt?: string
    default?: { providers?: Record<string, ModelsDevProviderRaw> }
  }
  const providers = snap.providers ?? snap.default?.providers
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new Error(`${MODELS_DEV_NPM_PACKAGE} snapshot.providers is not a provider map`)
  }
  const providerCount = Object.keys(providers).length
  if (providerCount < 1) {
    throw new Error(`${MODELS_DEV_NPM_PACKAGE} snapshot is empty`)
  }

  const text = JSON.stringify(providers)
  mkdirSync(dirname(paths.apiJsonPath), { recursive: true, mode: 0o700 })
  const tmp = `${paths.apiJsonPath}.${process.pid}.tmp`
  writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, paths.apiJsonPath)

  const meta = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: `npm:${MODELS_DEV_NPM_PACKAGE}@${packageVersion}/snapshot`,
    providerCount,
    bytes: Buffer.byteLength(text, 'utf8'),
    ...(typeof snap.generatedAt === 'string' ? { generatedAt: snap.generatedAt } : {}),
  }
  const metaTmp = `${paths.metaPath}.${process.pid}.tmp`
  writeFileSync(metaTmp, JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(metaTmp, paths.metaPath)

  return {
    meta,
    providerCount,
    fromCache: false,
    packageVersion,
    generatedAt: typeof snap.generatedAt === 'string' ? snap.generatedAt : undefined,
    via: 'npm-snapshot',
  }
}

/** Test helper: wipe install prefix. */
export function clearModelsDevNpmInstallPrefix(prefixDir = defaultPrefixDir()): void {
  try {
    rmSync(prefixDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
