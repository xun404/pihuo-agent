import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyHealthReport,
  healthHintsForKind,
  parseHealthDepth,
  probeWorkerHealth,
  type SpawnProbeResult,
} from './health.js'

const baseWorker = {
  name: 'Test',
  kind: 'custom' as const,
  command: 'mycli',
  args: [] as string[],
}

describe('probeWorkerHealth', () => {
  it('returns healthy with version on exit 0', async () => {
    const report = await probeWorkerHealth(baseWorker, {
      runCommand: async () =>
        ({
          exitCode: 0,
          stdout: 'mycli 1.2.3\n',
        }) satisfies SpawnProbeResult,
    })
    assert.equal(report.status, 'healthy')
    assert.equal(report.level, 'version')
    assert.ok(report.version?.includes('1.2.3'))
    assert.ok((report.latencyMs ?? 0) >= 0)
  })

  it('returns missing on ENOENT', async () => {
    const report = await probeWorkerHealth(
      { ...baseWorker, kind: 'opencode', command: 'opencode' },
      {
        runCommand: async () =>
          ({
            exitCode: null,
            errorCode: 'ENOENT',
          }) satisfies SpawnProbeResult,
      },
    )
    assert.equal(report.status, 'missing')
    assert.ok(report.hints && report.hints.length > 0)
    assert.ok(report.message?.toLowerCase().includes('not found'))
  })

  it('returns unhealthy on timeout', async () => {
    const report = await probeWorkerHealth(baseWorker, {
      runCommand: async () =>
        ({
          exitCode: null,
          timedOut: true,
        }) satisfies SpawnProbeResult,
    })
    assert.equal(report.status, 'unhealthy')
    assert.ok(report.message?.toLowerCase().includes('timed out'))
  })

  it('treats exit code 1 as healthy (help often returns 1)', async () => {
    const report = await probeWorkerHealth(baseWorker, {
      runCommand: async () => ({ exitCode: 1, stdout: 'usage: mycli' }),
    })
    assert.equal(report.status, 'healthy')
  })

  it('acp depth: timed-out live process is healthy', async () => {
    let calls = 0
    const report = await probeWorkerHealth(
      { ...baseWorker, args: ['acp'] },
      {
        level: 'acp_handshake',
        runCommand: async () => {
          calls += 1
          if (calls === 1) return { exitCode: 0, stdout: 'v1' }
          return { exitCode: null, timedOut: true }
        },
      },
    )
    assert.equal(report.status, 'healthy')
    assert.equal(report.level, 'acp_handshake')
  })
})

describe('health helpers', () => {
  it('parseHealthDepth maps aliases', () => {
    assert.equal(parseHealthDepth('acp_handshake'), 'acp')
    assert.equal(parseHealthDepth('version'), 'version')
    assert.equal(parseHealthDepth('nope'), 'version')
  })

  it('applyHealthReport sets shortcuts', () => {
    const w = applyHealthReport(
      {
        id: 'w1',
        name: 'X',
        kind: 'custom',
        command: 'x',
        args: [],
        primaryRole: 'general',
        roles: ['general'],
        capabilities: ['general'],
        enabled: true,
        scope: 'global',
        description: '',
        health: 'unknown',
      },
      {
        status: 'healthy',
        level: 'version',
        checkedAt: '2026-01-01T00:00:00.000Z',
        message: 'ok',
      },
    )
    assert.equal(w.health, 'healthy')
    assert.equal(w.lastSeenAt, '2026-01-01T00:00:00.000Z')
    assert.equal(w.healthReport?.message, 'ok')
  })

  it('hints for opencode missing', () => {
    const h = healthHintsForKind('opencode', 'missing')
    assert.ok(h.some((x) => x.toLowerCase().includes('opencode') || x.includes('PATH')))
  })
})
