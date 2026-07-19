import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('acp-registry-contract', () => {
  it('passes against bundled registry without spawning agents', () => {
    const r = spawnSync(
      process.execPath,
      [join(root, 'scripts/acp-registry-contract.mjs'), '--json'],
      { encoding: 'utf8', cwd: root },
    )
    assert.equal(r.status, 0, r.stderr || r.stdout)
    const report = JSON.parse(r.stdout)
    assert.equal(report.ok, true)
    assert.ok(report.agentCount > 0)
    assert.ok(String(report.schemaVersion).startsWith('1.'))
    assert.ok(report.distributions.npx + report.distributions.uvx + report.distributions.binary > 0)
  })

  it('smoke refuses without confirm flag', () => {
    const r = spawnSync(
      process.execPath,
      [join(root, 'scripts/acp-registry-smoke.mjs'), '--agents', 'x'],
      { encoding: 'utf8', cwd: root },
    )
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Refused|confirm-third-party/i)
  })
})
