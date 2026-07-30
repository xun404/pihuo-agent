import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidSessionPermissionMode,
  permissionModeFromLegacyPolicy,
  isModelCacheFresh,
  WORKER_MODELS_TTL_MS,
  COMMAND_HEALTH_TTL_MS,
  ACP_HEALTH_TTL_MS,
  isCommandHealthFresh,
  isAcpHealthFresh,
  normalizeWorkerHealth,
  projectLegacyHealth,
  shouldSkipWorkerDispatch,
  workerHealthRank,
} from './index.js'

describe('Session permission mode', () => {
  it('accepts only the two public permission modes', () => {
    assert.equal(isValidSessionPermissionMode('default'), true)
    assert.equal(isValidSessionPermissionMode('auto'), true)
    assert.equal(isValidSessionPermissionMode('manual'), false)
    assert.equal(isValidSessionPermissionMode(undefined), false)
  })

  it('maps every legacy approval policy and unknown input fail-closed', () => {
    assert.equal(permissionModeFromLegacyPolicy('manual'), 'default')
    assert.equal(permissionModeFromLegacyPolicy('reject_once'), 'default')
    assert.equal(permissionModeFromLegacyPolicy('reject_always'), 'default')
    assert.equal(permissionModeFromLegacyPolicy('allow_once'), 'auto')
    assert.equal(permissionModeFromLegacyPolicy('allow_always'), 'auto')
    assert.equal(permissionModeFromLegacyPolicy('allow_everything'), 'default')
    assert.equal(permissionModeFromLegacyPolicy(undefined), 'default')
  })
})

describe('isModelCacheFresh', () => {
  it('returns false when modelsFetchedAt is undefined', () => {
    assert.equal(isModelCacheFresh(undefined), false)
  })

  it('returns false when modelsFetchedAt is invalid', () => {
    assert.equal(isModelCacheFresh('not-a-date'), false)
  })

  it('returns true when within default TTL', () => {
    const now = new Date().toISOString()
    assert.equal(isModelCacheFresh(now), true)
  })

  it('returns false when past TTL', () => {
    const past = new Date(Date.now() - WORKER_MODELS_TTL_MS - 1000).toISOString()
    assert.equal(isModelCacheFresh(past), false)
  })

  it('accepts custom TTL', () => {
    const past = new Date(Date.now() - 1000).toISOString()
    assert.equal(isModelCacheFresh(past, 500), false)
    assert.equal(isModelCacheFresh(past, 2000), true)
  })

  it('accepts injectable now', () => {
    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    const fetched = new Date(t0).toISOString()
    assert.equal(isModelCacheFresh(fetched, 1000, t0 + 500), true)
    assert.equal(isModelCacheFresh(fetched, 1000, t0 + 1500), false)
  })
})

describe('isCommandHealthFresh / isAcpHealthFresh', () => {
  it('uses COMMAND_HEALTH_TTL_MS = 5m and ACP_HEALTH_TTL_MS = 15m', () => {
    assert.equal(COMMAND_HEALTH_TTL_MS, 5 * 60 * 1000)
    assert.equal(ACP_HEALTH_TTL_MS, 15 * 60 * 1000)
  })

  it('isCommandHealthFresh respects TTL and now', () => {
    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    assert.equal(isCommandHealthFresh(undefined, t0), false)
    assert.equal(
      isCommandHealthFresh({ status: 'healthy', checkedAt: new Date(t0).toISOString() }, t0 + 1000),
      true,
    )
    assert.equal(
      isCommandHealthFresh(
        { status: 'healthy', checkedAt: new Date(t0).toISOString() },
        t0 + COMMAND_HEALTH_TTL_MS + 1,
      ),
      false,
    )
  })

  it('isAcpHealthFresh respects TTL and now', () => {
    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    assert.equal(
      isAcpHealthFresh({ status: 'ready', checkedAt: new Date(t0).toISOString() }, t0 + 1000),
      true,
    )
    assert.equal(
      isAcpHealthFresh(
        { status: 'ready', checkedAt: new Date(t0).toISOString() },
        t0 + ACP_HEALTH_TTL_MS + 1,
      ),
      false,
    )
  })
})

describe('normalizeWorkerHealth', () => {
  it('defaults command from legacy health; ACP stays unknown', () => {
    const result = normalizeWorkerHealth({
      id: 'w1',
      name: 'Test',
      kind: 'custom' as const,
      command: 'mycli',
      args: [],
      health: 'healthy',
    })
    assert.equal(result.cliHealth, 'healthy')
    // Legacy health is command-only input; do not invent ACP ready
    assert.equal(result.acpSessionHealth, 'unknown')
    assert.equal(result.acpHealth.status, 'unknown')
    assert.equal(result.health, 'healthy')
  })

  it('uses provided cliHealth and acpSessionHealth when set', () => {
    const result = normalizeWorkerHealth({
      id: 'w1',
      name: 'Test',
      kind: 'custom' as const,
      command: 'mycli',
      args: [],
      health: 'healthy',
      cliHealth: 'healthy',
      acpSessionHealth: 'unhealthy',
    })
    assert.equal(result.cliHealth, 'healthy')
    assert.equal(result.acpSessionHealth, 'unhealthy')
    assert.equal(result.health, 'unhealthy')
  })

  it('computes health as worst of cliHealth and acpSessionHealth', () => {
    const result = normalizeWorkerHealth({
      id: 'w1',
      name: 'Test',
      kind: 'custom' as const,
      command: 'mycli',
      args: [],
      health: 'healthy',
      cliHealth: 'healthy',
      acpSessionHealth: 'missing',
    })
    assert.equal(result.cliHealth, 'healthy')
    assert.equal(result.acpSessionHealth, 'missing')
    assert.equal(result.health, 'missing')
  })

  it('preserves healthReport when provided', () => {
    const result = normalizeWorkerHealth({
      id: 'w1',
      name: 'Test',
      kind: 'custom' as const,
      command: 'mycli',
      args: [],
      health: 'unknown',
      cliHealth: 'healthy',
      acpSessionHealth: 'healthy',
      healthReport: {
        status: 'healthy',
        level: 'version',
        checkedAt: '2026-01-01T00:00:00.000Z',
        message: 'ok',
      },
    })
    assert.equal(result.healthReport?.message, 'ok')
  })

  it('sets unknown defaults when nothing provided', () => {
    const result = normalizeWorkerHealth({
      id: 'w1',
      name: 'Test',
      kind: 'custom' as const,
      command: 'mycli',
      args: [],
    })
    assert.equal(result.cliHealth, 'unknown')
    assert.equal(result.acpSessionHealth, 'unknown')
    assert.equal(result.health, 'unknown')
  })

  it('projects commandHealth and acpHealth from legacy fields', () => {
    const result = normalizeWorkerHealth({
      id: 'w1',
      name: 'Test',
      kind: 'custom' as const,
      command: 'mycli',
      args: [],
      health: 'healthy',
      cliHealth: 'healthy',
      acpSessionHealth: 'unhealthy',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    })
    assert.equal(result.commandHealth?.status, 'healthy')
    assert.equal(result.commandHealth?.checkedAt, '2026-01-01T00:00:00.000Z')
    assert.equal(result.acpHealth?.status, 'degraded')
    assert.equal(result.acpHealth?.checkedAt, '2026-01-01T00:00:00.000Z')
  })

  it('projects legacy fields from commandHealth and acpHealth', () => {
    const result = normalizeWorkerHealth({
      id: 'w1',
      name: 'Test',
      kind: 'custom' as const,
      command: 'mycli',
      args: [],
      commandHealth: { status: 'missing', checkedAt: '2026-02-01T00:00:00.000Z' },
      acpHealth: {
        status: 'unavailable',
        checkedAt: '2026-02-01T00:00:00.000Z',
        errorCode: 'ACP_DOWN',
      },
    })
    assert.equal(result.cliHealth, 'missing')
    assert.equal(result.acpSessionHealth, 'missing')
    assert.equal(result.health, 'missing')
    assert.equal(result.commandHealth?.status, 'missing')
    assert.equal(result.acpHealth?.status, 'unavailable')
    assert.equal(result.acpHealth?.errorCode, 'ACP_DOWN')
  })
})

describe('projectLegacyHealth', () => {
  it('maps acp ready/degraded/unavailable bidirectionally', () => {
    const ready = projectLegacyHealth({
      commandHealth: { status: 'healthy', checkedAt: '2026-01-01T00:00:00.000Z' },
      acpHealth: { status: 'ready', checkedAt: '2026-01-01T00:00:00.000Z' },
    })
    assert.equal(ready.acpSessionHealth, 'healthy')
    assert.equal(ready.cliHealth, 'healthy')
    assert.equal(ready.health, 'healthy')

    const degraded = projectLegacyHealth({
      cliHealth: 'healthy',
      acpHealth: { status: 'degraded' },
    })
    assert.equal(degraded.acpSessionHealth, 'unhealthy')
    assert.equal(degraded.health, 'unhealthy')

    const fromLegacy = projectLegacyHealth({
      acpSessionHealth: 'missing',
    })
    assert.equal(fromLegacy.acpHealth?.status, 'unavailable')

    // Legacy health alone must NOT project as ACP ready
    const commandOnly = projectLegacyHealth({
      health: 'healthy',
    })
    assert.equal(commandOnly.commandHealth.status, 'healthy')
    assert.equal(commandOnly.acpHealth.status, 'unknown')
  })
})

describe('shouldSkipWorkerDispatch', () => {
  const t0 = Date.parse('2026-01-01T00:00:00.000Z')

  it('skips non-force when fresh commandHealth is missing', () => {
    assert.equal(
      shouldSkipWorkerDispatch(
        {
          commandHealth: {
            status: 'missing',
            checkedAt: new Date(t0).toISOString(),
          },
        },
        { forced: false, now: t0 + 1000 },
      ),
      true,
    )
  })

  it('skips non-force when fresh commandHealth is unhealthy', () => {
    assert.equal(
      shouldSkipWorkerDispatch(
        {
          commandHealth: {
            status: 'unhealthy',
            checkedAt: new Date(t0).toISOString(),
          },
        },
        { forced: false, now: t0 + 1000 },
      ),
      true,
    )
  })

  it('skips non-force when fresh acpHealth is unavailable', () => {
    assert.equal(
      shouldSkipWorkerDispatch(
        {
          commandHealth: { status: 'healthy', checkedAt: new Date(t0).toISOString() },
          acpHealth: { status: 'unavailable', checkedAt: new Date(t0).toISOString() },
        },
        { forced: false, now: t0 + 1000 },
      ),
      true,
    )
  })

  it('allows degraded or expired ACP', () => {
    assert.equal(
      shouldSkipWorkerDispatch(
        {
          commandHealth: { status: 'healthy', checkedAt: new Date(t0).toISOString() },
          acpHealth: { status: 'degraded', checkedAt: new Date(t0).toISOString() },
        },
        { forced: false, now: t0 + 1000 },
      ),
      false,
    )
    assert.equal(
      shouldSkipWorkerDispatch(
        {
          commandHealth: { status: 'healthy', checkedAt: new Date(t0).toISOString() },
          acpHealth: {
            status: 'unavailable',
            checkedAt: new Date(t0).toISOString(),
          },
        },
        { forced: false, now: t0 + ACP_HEALTH_TTL_MS + 1 },
      ),
      false,
    )
  })

  it('never skips forced selection for health', () => {
    assert.equal(
      shouldSkipWorkerDispatch(
        {
          commandHealth: { status: 'missing', checkedAt: new Date(t0).toISOString() },
          acpHealth: { status: 'unavailable', checkedAt: new Date(t0).toISOString() },
        },
        { forced: true, now: t0 + 1000 },
      ),
      false,
    )
  })
})

describe('workerHealthRank', () => {
  it('orders from missing (worst) to healthy (best)', () => {
    assert.ok(workerHealthRank('missing') < workerHealthRank('unhealthy'))
    assert.ok(workerHealthRank('unhealthy') < workerHealthRank('unknown'))
    assert.ok(workerHealthRank('unknown') < workerHealthRank('healthy'))
  })
})
