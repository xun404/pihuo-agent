/**
 * Maintenance: generate versioned RegistrySnapshot + curated built-in providers
 * from installed @mastra/core. Run on package (and optionally release CI).
 *
 * Usage: npm run sync:model-registry -w @swarmdesk-agent/mastra-app
 *
 * Outputs:
 * - packages/core/src/bundled/mastra-model-registry.json  (allowlisted providers only)
 * - packages/core/src/bundled/builtin-providers.json      (Settings curated list)
 * - persisted user data registry (same allowlist, local LKG)
 *
 * Curation policy: packages/core/src/bundled/builtin-providers.policy.json
 *
 * IMPORTANT: Never dump the full Mastra mega-registry (OpenRouter/NanoGPT/…) into
 * git. Only providers listed in the policy are written to bundled LKG.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  writePersistedRegistrySnapshot,
  persistedRegistryPath,
  type RegistrySnapshot,
} from '@swarmdesk-agent/core'
import { buildBuiltinCatalog, type BuiltinProvidersPolicy } from './curate-builtin-providers.ts'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')
const coreBundledDir = join(root, 'packages/core/src/bundled')

type RawProvider = {
  name: string
  apiKeyEnvVar: string | string[]
  models?: string[]
  docUrl?: string
}

function mastraVersion(): string {
  try {
    const pkg = require('@mastra/core/package.json') as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function findRegistryPath(): string | null {
  const candidates = [
    process.env.MASTRA_PROVIDER_REGISTRY_PATH,
    join(root, 'node_modules/@mastra/core/dist/provider-registry.json'),
    join(here, '../node_modules/@mastra/core/dist/provider-registry.json'),
  ].filter(Boolean) as string[]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function buildAllowlistedSnapshot(
  rawProviders: Record<string, RawProvider>,
  allowIds: string[],
  version: string,
  generatedAt: string,
  source: RegistrySnapshot['source'],
): RegistrySnapshot {
  const providers: RegistrySnapshot['providers'] = []
  for (const id of allowIds) {
    const p = rawProviders[id]
    if (!p) {
      console.warn(
        `[sync:model-registry] policy provider "${id}" missing from Mastra registry — skipped`,
      )
      continue
    }
    providers.push({
      id,
      name: p.name ?? id,
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: (p.models ?? []).map((mid) => ({
        id: mid.includes('/') ? mid : `${id}/${mid}`,
        label: mid,
      })),
    })
  }
  return {
    version: 1,
    source,
    mastraPackageVersion: version,
    generatedAt,
    providers,
  }
}

function main() {
  const regPath = findRegistryPath()
  if (!regPath) {
    console.error('provider-registry.json not found; install @mastra/core first')
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(regPath, 'utf8')) as {
    providers?: Record<string, RawProvider>
  }
  if (!raw.providers) {
    console.error('invalid registry: no providers')
    process.exit(1)
  }

  const policyPath = join(coreBundledDir, 'builtin-providers.policy.json')
  if (!existsSync(policyPath)) {
    console.error('missing policy', policyPath)
    process.exit(1)
  }
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as BuiltinProvidersPolicy
  const allowIds = policy.providers.map((p) => p.id)
  if (allowIds.length === 0) {
    console.error('policy has no providers')
    process.exit(1)
  }

  const version = mastraVersion()
  const generatedAt = new Date().toISOString()
  const fullProviderCount = Object.keys(raw.providers).length
  const fullModelCount = Object.values(raw.providers).reduce(
    (n, p) => n + (p.models?.length ?? 0),
    0,
  )

  // Bundled LKG: only policy allowlist (keeps git / install package small)
  const snapshot = buildAllowlistedSnapshot(
    raw.providers,
    allowIds,
    version,
    generatedAt,
    'bundled',
  )
  const modelCount = snapshot.providers.reduce((n, p) => n + p.models.length, 0)

  mkdirSync(coreBundledDir, { recursive: true })
  const bundledRegistryPath = join(coreBundledDir, 'mastra-model-registry.json')
  writeFileSync(bundledRegistryPath, JSON.stringify(snapshot, null, 2), 'utf8')
  console.log(
    'wrote bundled registry',
    bundledRegistryPath,
    `mastra=${version}`,
    `providers=${snapshot.providers.length}/${fullProviderCount}`,
    `models=${modelCount}/${fullModelCount}`,
    `(allowlist: ${allowIds.join(', ')})`,
  )

  // Curated Settings built-ins from policy + allowlisted registry models
  const registryByProvider: Record<string, string[]> = {}
  for (const id of allowIds) {
    registryByProvider[id] = raw.providers[id]?.models ?? []
  }
  const catalog = buildBuiltinCatalog(policy, registryByProvider, version, generatedAt)
  const builtinPath = join(coreBundledDir, 'builtin-providers.json')
  writeFileSync(builtinPath, JSON.stringify(catalog, null, 2), 'utf8')
  console.log(
    'wrote curated built-ins',
    builtinPath,
    'providers',
    catalog.providers.length,
    'defaultLeader',
    catalog.defaultLeaderModel,
  )
  for (const p of catalog.providers) {
    console.log(
      `  ${p.id}: ${p.models.map((m) => m.id.split('/').slice(1).join('/')).join(', ') || '(none)'}`,
    )
  }

  // Local LKG uses the same allowlist — never dump mega-registry into user data either
  writePersistedRegistrySnapshot({ ...snapshot, source: 'persisted' })
  console.log('wrote persisted registry', persistedRegistryPath())
}

main()
