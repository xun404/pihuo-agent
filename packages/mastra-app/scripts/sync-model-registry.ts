/**
 * Maintenance: generate versioned RegistrySnapshot from installed @mastra/core.
 * Run from packages/mastra-app (depends on Mastra). Does not run on request path.
 *
 * Usage: npm run sync:model-registry -w @router-agents/mastra-app
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  writePersistedRegistrySnapshot,
  persistedRegistryPath,
  type RegistrySnapshot,
} from '@router-agents/core'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')

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

function main() {
  const regPath = findRegistryPath()
  if (!regPath) {
    console.error('provider-registry.json not found; install @mastra/core first')
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(regPath, 'utf8')) as {
    providers?: Record<
      string,
      {
        name: string
        apiKeyEnvVar: string | string[]
        models?: string[]
      }
    >
  }
  if (!raw.providers) {
    console.error('invalid registry: no providers')
    process.exit(1)
  }
  const version = mastraVersion()
  const snapshot: RegistrySnapshot = {
    version: 1,
    source: 'bundled',
    mastraPackageVersion: version,
    generatedAt: new Date().toISOString(),
    providers: Object.entries(raw.providers).map(([id, p]) => ({
      id,
      name: p.name ?? id,
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: (p.models ?? []).map((mid) => ({
        id: mid.includes('/') ? mid : `${id}/${mid}`,
        label: mid,
      })),
    })),
  }

  // Bundled snapshot for release (relative to monorepo)
  const bundledDir = join(root, 'packages/core/src/bundled')
  mkdirSync(bundledDir, { recursive: true })
  const bundledPath = join(bundledDir, 'mastra-model-registry.json')
  writeFileSync(bundledPath, JSON.stringify(snapshot, null, 2), 'utf8')
  console.log('wrote bundled snapshot', bundledPath, 'mastra', version)

  // Also refresh persisted last-known-good for local dev
  writePersistedRegistrySnapshot({ ...snapshot, source: 'persisted' })
  console.log('wrote persisted snapshot', persistedRegistryPath())
}

main()
