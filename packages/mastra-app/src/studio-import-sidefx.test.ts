/**
 * Black-box: importing Studio entry in an isolated child process must not
 * create/modify state.json, take owner lease, or construct a writable Scheduler path.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const studioEntry = join(packageRoot, 'src/mastra/index.ts')

describe('Studio entry static import side effects', () => {
  it('client-only import does not create state.json or catalog lease', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-sidefx-'))
    // ROUTER_DATA_DIR pins the app root; the data layer lives under <root>/data.
    const dataLayer = join(dir, 'data')
    mkdirSync(dataLayer, { recursive: true })
    const statePath = join(dataLayer, 'state.json')
    const catalogPath = join(dataLayer, 'acp-sessions.json')
    const leasePath = `${catalogPath}.owner`
    // Pre-seed a "foreign" lease so any accidental acquire would fail loudly or steal
    writeFileSync(
      leasePath,
      JSON.stringify({
        version: 1,
        pid: 1,
        processStartedAt: '1970-01-01T00:00:00.000Z',
        ownerTokenHash: 'dead',
        createdAt: '1970-01-01T00:00:00.000Z',
        heartbeatAt: new Date().toISOString(),
      }),
      'utf8',
    )
    const leaseBefore = readFileSync(leasePath, 'utf8')

    const script = `
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const dataDir = process.env.ROUTER_DATA_DIR
const statePath = process.env.ROUTER_AGENTS_STATE
try {
  await import(${JSON.stringify(studioEntry)})
} catch (e) {
  // Import may fail if Mastra deps need network etc — still check side effects
  console.error('import_error', e instanceof Error ? e.message : String(e))
}
const out = {
  stateExists: existsSync(statePath),
  clientOnly: process.env.ROUTER_CLIENT_ONLY,
  role: process.env.ROUTER_RUNTIME_ROLE,
  dataEntries: existsSync(dataDir) ? readdirSync(dataDir) : [],
}
console.log('SIDEFX_JSON:' + JSON.stringify(out))
`
    const scriptPath = join(dir, 'import-studio.mjs')
    writeFileSync(scriptPath, script)

    const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath], {
      cwd: packageRoot,
      env: {
        ...process.env,
        HOME: dir,
        ROUTER_DATA_DIR: dir,
        ROUTER_AGENTS_STATE: statePath,
        ACP_CATALOG_PATH: catalogPath,
        ROUTER_RUNTIME_ROLE: 'client-only',
      },
      encoding: 'utf8',
      timeout: 60_000,
    })

    const stdout = result.stdout ?? ''
    const line = stdout.split('\n').find((l) => l.startsWith('SIDEFX_JSON:'))
    assert.ok(
      line,
      `expected SIDEFX_JSON marker, got stdout=${stdout.slice(0, 500)} stderr=${(result.stderr ?? '').slice(0, 500)}`,
    )
    const payload = JSON.parse(line!.slice('SIDEFX_JSON:'.length)) as {
      stateExists: boolean
      clientOnly: string
      role: string
      dataEntries: string[]
    }

    assert.equal(payload.stateExists, false, 'state.json must not be created by Studio import')
    assert.equal(payload.clientOnly, '1')
    assert.equal(payload.role, 'client-only')
    assert.equal(existsSync(statePath), false, 'state.json must not exist after child exit')
    // Lease file content must be unchanged (no steal / rewrite)
    assert.equal(readFileSync(leasePath, 'utf8'), leaseBefore)
    // No new .owner takeover mutex for our catalog
    assert.equal(existsSync(`${leasePath}.takeover`), false)

    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })
})
