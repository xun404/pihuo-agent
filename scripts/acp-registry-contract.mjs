#!/usr/bin/env node
/**
 * ACP Registry contract: parse local bundled or remote registry without spawning agents.
 * Does not execute third-party Agent code.
 *
 * Usage:
 *   node scripts/acp-registry-contract.mjs
 *   node scripts/acp-registry-contract.mjs --remote
 *   node scripts/acp-registry-contract.mjs --json
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const bundledPath = join(root, 'packages/adapters/src/bundled/acp-registry.json')
const schemaPath = join(root, 'packages/adapters/src/bundled/acp-registry.schema.json')
const REMOTE_URL =
  process.env.ACP_REGISTRY_URL ??
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

const args = new Set(process.argv.slice(2))
const useRemote = args.has('--remote')
const asJson = args.has('--json')

function fail(msg, code = 1) {
  console.error(`[acp-registry-contract] ${msg}`)
  process.exit(code)
}

async function loadRegistry() {
  if (useRemote) {
    const res = await fetch(REMOTE_URL, {
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) fail(`remote fetch failed: HTTP ${res.status}`)
    return { source: 'remote', data: await res.json(), url: REMOTE_URL }
  }
  if (!existsSync(bundledPath)) fail(`bundled registry missing: ${bundledPath}`)
  return {
    source: 'bundled',
    data: JSON.parse(readFileSync(bundledPath, 'utf8')),
    url: bundledPath,
  }
}

function countDistributions(agents) {
  let npx = 0
  let uvx = 0
  let binary = 0
  let multi = 0
  let withSha = 0
  let binaryTotal = 0
  for (const a of agents) {
    const d = a.distribution ?? {}
    const kinds = []
    if (d.npx) {
      npx++
      kinds.push('npx')
    }
    if (d.uvx) {
      uvx++
      kinds.push('uvx')
    }
    if (d.binary) {
      binary++
      kinds.push('binary')
      const bins = Array.isArray(d.binary) ? d.binary : Object.values(d.binary)
      for (const b of bins) {
        if (b && typeof b === 'object') {
          binaryTotal++
          if (b.sha256 || b.sha256sum) withSha++
        }
      }
    }
    if (kinds.length > 1) multi++
    if (kinds.length === 0) {
      // v2 style distributions array
      if (Array.isArray(a.distributions) && a.distributions.length > 0) {
        for (const dist of a.distributions) {
          if (dist.kind === 'npx') npx++
          if (dist.kind === 'uvx') uvx++
          if (dist.kind === 'binary') binary++
        }
      }
    }
  }
  return { npx, uvx, binary, multi, binaryArtifacts: binaryTotal, binaryWithSha: withSha }
}

function validateStructure(data) {
  const errors = []
  if (!data || typeof data !== 'object') {
    errors.push('root is not an object')
    return { errors, agents: [] }
  }
  const schemaVersion = data.schemaVersion ?? data.version
  if (!schemaVersion || typeof schemaVersion !== 'string') {
    errors.push('missing schemaVersion/version string')
  } else if (!schemaVersion.startsWith('1.')) {
    errors.push(`unsupported schema major: ${schemaVersion}`)
  }
  const agents = Array.isArray(data.agents) ? data.agents : []
  if (agents.length === 0) errors.push('agents array empty')
  for (const a of agents) {
    if (!a?.id || !a?.name) {
      errors.push(`agent missing id/name: ${JSON.stringify(a?.id)}`)
      continue
    }
    const hasDist = a.distribution || (Array.isArray(a.distributions) && a.distributions.length > 0)
    if (!hasDist) errors.push(`agent ${a.id} has no distribution`)
  }
  return { errors, agents, schemaVersion }
}

async function main() {
  const loaded = await loadRegistry()
  const { errors, agents, schemaVersion } = validateStructure(loaded.data)
  const dist = countDistributions(agents)
  const digest = createHash('sha256').update(JSON.stringify(loaded.data)).digest('hex')

  const report = {
    ok: errors.length === 0,
    source: loaded.source,
    url: loaded.url,
    schemaVersion: schemaVersion ?? null,
    agentCount: agents.length,
    // count is observational — not a hard product constant
    distributions: dist,
    contentSha256: `sha256:${digest}`,
    schemaFilePresent: existsSync(schemaPath),
    errors,
    note: 'Contract does not spawn Agents. auth_required is not a protocol failure. Use smoke:acp-registry with explicit --confirm-third-party-execution for live probes.',
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('ACP Registry Contract Report')
    console.log('============================')
    console.log(`source:         ${report.source}`)
    console.log(`schemaVersion:  ${report.schemaVersion}`)
    console.log(`agentCount:     ${report.agentCount}`)
    console.log(
      `distributions:  npx=${dist.npx} uvx=${dist.uvx} binary=${dist.binary} multi=${dist.multi}`,
    )
    console.log(`binary sha:     ${dist.binaryWithSha}/${dist.binaryArtifacts} declared`)
    console.log(`content digest: ${report.contentSha256.slice(0, 24)}…`)
    if (errors.length) {
      console.log('errors:')
      for (const e of errors) console.log(`  - ${e}`)
    } else {
      console.log('status:         PASS')
    }
  }

  if (!report.ok) fail(`contract failed with ${errors.length} error(s)`)
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
