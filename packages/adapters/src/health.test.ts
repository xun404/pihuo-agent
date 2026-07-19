import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  acpHealthFromJobOutcome,
  applyHealthReport,
  healthHintsForKind,
  parseHealthDepth,
  probeWorkerHealth,
  resolveHealthTimeoutMs,
  type SpawnProbeResult,
} from './health.js'

const baseWorker = {
  name: 'Test',
  kind: 'custom' as const,
  command: 'mycli',
  args: [] as string[],
}

describe('health timeout boundaries', () => {
  it('uses a bounded positive integer for every process timer', () => {
    assert.equal(resolveHealthTimeoutMs(2500, 4000), 2500)
    assert.equal(resolveHealthTimeoutMs(10.9, 4000), 10)
    assert.equal(resolveHealthTimeoutMs(0, 4000), 4000)
    assert.equal(resolveHealthTimeoutMs(-1, 4000), 4000)
    assert.equal(resolveHealthTimeoutMs(Number.POSITIVE_INFINITY, 4000), 4000)
    assert.equal(resolveHealthTimeoutMs(9_999_999_999, 4000), 2_147_483_647)
  })
})

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
        acpSessionHealth: 'healthy',
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
    assert.equal(w.commandHealth?.status, 'healthy')
    assert.equal(w.commandHealth?.checkedAt, '2026-01-01T00:00:00.000Z')
  })

  it('applyHealthReport sets cliHealth for version/presence healthy', () => {
    const checkedAt = new Date().toISOString()
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
      { status: 'healthy', level: 'version', checkedAt, message: 'ok' },
    )
    assert.equal(w.cliHealth, 'healthy')
    assert.equal(w.acpSessionHealth, 'unknown')
    // Unknown ACP does not drag command-healthy down
    assert.equal(w.health, 'healthy')
    assert.equal(w.commandHealth?.status, 'healthy')
    assert.equal(w.commandHealth?.checkedAt, checkedAt)
    assert.equal(w.acpHealth?.status, 'unknown')
  })

  it('applyHealthReport spawn_only probe does not set acp ready', () => {
    const checkedAt = new Date().toISOString()
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
        level: 'acp_handshake',
        checkedAt,
        message: 'spawn only',
        detail: { probeKind: 'spawn_only' },
      },
    )
    assert.equal(w.commandHealth?.status, 'healthy')
    assert.equal(w.acpHealth?.status, 'unknown')
  })

  it('applyHealthReport sets both healthy for acp_handshake healthy (real session)', () => {
    const checkedAt = new Date().toISOString()
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
        level: 'acp_handshake',
        checkedAt,
        message: 'ok',
        detail: { probeKind: 'acp_session' },
      },
    )
    assert.equal(w.cliHealth, 'healthy')
    assert.equal(w.acpSessionHealth, 'healthy')
    assert.equal(w.health, 'healthy')
    assert.equal(w.commandHealth?.status, 'healthy')
    assert.equal(w.acpHealth?.status, 'ready')
    assert.equal(w.acpHealth?.lastSuccessAt, checkedAt)
  })

  it('applyHealthReport sets acpSessionHealth unhealthy when acp handshake fails', () => {
    const checkedAt = new Date().toISOString()
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
        cliHealth: 'healthy',
      },
      { status: 'unhealthy', level: 'acp_handshake', checkedAt, message: 'handshake failed' },
    )
    assert.equal(w.cliHealth, 'healthy')
    assert.equal(w.acpSessionHealth, 'unhealthy')
    assert.equal(w.health, 'unhealthy')
    assert.equal(w.acpHealth?.status, 'degraded')
    assert.equal(w.acpHealth?.checkedAt, checkedAt)
  })

  it('applyHealthReport maps acp missing to unavailable', () => {
    const checkedAt = new Date().toISOString()
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
        status: 'missing',
        level: 'acp_handshake',
        checkedAt,
        message: 'not found',
        detail: { errorCode: 'ENOENT' },
      },
    )
    assert.equal(w.cliHealth, 'missing')
    assert.equal(w.acpSessionHealth, 'missing')
    assert.equal(w.acpHealth?.status, 'unavailable')
    assert.equal(w.acpHealth?.errorCode, 'ENOENT')
  })

  it('applyHealthReport sets both missing for presence missing', () => {
    const checkedAt = new Date().toISOString()
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
      { status: 'missing', level: 'presence', checkedAt, message: 'not found' },
    )
    assert.equal(w.cliHealth, 'missing')
    assert.equal(w.acpSessionHealth, 'missing')
    assert.equal(w.health, 'missing')
    assert.equal(w.commandHealth?.status, 'missing')
    assert.equal(w.acpHealth?.status, 'unavailable')
  })

  it('applyHealthReport sets cliHealth unhealthy on presence timeout', () => {
    const checkedAt = new Date().toISOString()
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
      { status: 'unhealthy', level: 'presence', checkedAt, message: 'timed out' },
    )
    assert.equal(w.cliHealth, 'unhealthy')
    assert.equal(w.acpSessionHealth, 'unknown')
    assert.equal(w.health, 'unhealthy')
    assert.equal(w.commandHealth?.status, 'unhealthy')
  })

  it('hints for opencode missing', () => {
    const h = healthHintsForKind('opencode', 'missing')
    assert.ok(h.some((x) => x.toLowerCase().includes('opencode') || x.includes('PATH')))
  })
})

describe('acpHealthFromJobOutcome', () => {
  const T0 = Date.parse('2026-06-01T12:00:00.000Z')

  it('maps success to ready + lastSuccessAt', () => {
    const h = acpHealthFromJobOutcome('succeeded', { nowMs: T0 })
    assert.equal(h.status, 'ready')
    assert.equal(h.checkedAt, new Date(T0).toISOString())
    assert.equal(h.lastSuccessAt, new Date(T0).toISOString())
    assert.equal(h.errorCode, undefined)
  })

  it('maps hard ACP unavailability to unavailable + errorCode', () => {
    const h = acpHealthFromJobOutcome('failed', {
      nowMs: T0,
      errorCode: 'ENOENT',
      error: 'spawn opencode ENOENT',
    })
    assert.equal(h.status, 'unavailable')
    assert.equal(h.errorCode, 'ENOENT')
    assert.equal(h.checkedAt, new Date(T0).toISOString())
  })

  it('maps soft/partial ACP failures to degraded', () => {
    const h = acpHealthFromJobOutcome('failed', {
      nowMs: T0,
      error: 'ACP agent failed while processing the task.',
      lastSuccessAt: '2026-05-01T00:00:00.000Z',
    })
    assert.equal(h.status, 'degraded')
    assert.equal(h.lastSuccessAt, '2026-05-01T00:00:00.000Z')
  })

  it('treats initialize/connection failures as hard unavailable', () => {
    const h = acpHealthFromJobOutcome('failed', {
      nowMs: T0,
      error: 'failed to start ACP process: initialize timeout',
    })
    assert.equal(h.status, 'unavailable')
  })
})
