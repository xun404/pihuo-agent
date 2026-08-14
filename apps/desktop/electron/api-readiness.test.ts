import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  allowsExistingApiReuse,
  createSerialTaskRunner,
  isOwnedLegacyApiProcess,
  isWatchSupervisor,
  matchesApiIdentity,
  parseListenerPids,
  shouldStopApiOnAllWindowsClosed,
  shouldWaitForOwnedApiOnQuit,
  workspaceIdentity,
} from './api-readiness.js'

const startedAt = '2026-07-15T12:00:00.000Z'
const ownerEpoch = `4242:${startedAt}`

function validIdentity() {
  return {
    health: {
      ok: true,
      service: 'pihuo-agent-api',
      port: 4111,
      pid: 4242,
      startedAt,
      ownerEpoch,
      workspaceId: workspaceIdentity('/repo/pihuo-agent'),
    },
    discovery: {
      port: 4111,
      pid: 4242,
      startedAt,
      ownerEpoch,
      desktopToken: 'd'.repeat(32),
      workspaceId: workspaceIdentity('/repo/pihuo-agent'),
    },
    expectedPort: 4111,
    expectedWorkspaceRoot: '/repo/pihuo-agent',
  }
}

describe('desktop API readiness identity', () => {
  it('accepts only a complete matching router API identity', () => {
    assert.equal(matchesApiIdentity(validIdentity()), true)
  })

  it('rejects an unrelated healthy service on the configured port', () => {
    const input = validIdentity()
    input.health.service = 'some-other-service'
    assert.equal(matchesApiIdentity(input), false)
  })

  it('rejects mismatched health and discovery process identity', () => {
    const input = validIdentity()
    input.health.pid = 9999
    assert.equal(matchesApiIdentity(input), false)
  })

  it('rejects a valid external API when waiting for the child just spawned', () => {
    const input = validIdentity()
    assert.equal(
      matchesApiIdentity({
        ...input,
        expectedChild: { pid: 7777, spawnedAt: Date.parse(startedAt) - 500 },
      }),
      false,
    )
  })

  it('rejects stale discovery epochs and pre-spawn identities', () => {
    const staleEpoch = validIdentity()
    staleEpoch.discovery.ownerEpoch = `4242:2026-07-15T11:59:00.000Z`
    assert.equal(matchesApiIdentity(staleEpoch), false)

    const preSpawn = validIdentity()
    assert.equal(
      matchesApiIdentity({
        ...preSpawn,
        expectedChild: { pid: 4242, spawnedAt: Date.parse(startedAt) + 2_000 },
      }),
      false,
    )
  })

  it('rejects a verified Router API from a different checkout', () => {
    const input = validIdentity()
    input.health.workspaceId = workspaceIdentity('/repo/other-checkout')
    assert.equal(matchesApiIdentity(input), false)

    const staleDiscovery = validIdentity()
    staleDiscovery.discovery.workspaceId = workspaceIdentity('/repo/other-checkout')
    assert.equal(matchesApiIdentity(staleDiscovery), false)
  })
})

describe('legacy API retirement boundary', () => {
  it('parses only valid unique listener pids', () => {
    assert.deepEqual(parseListenerPids('81092\n81092\nnope\n42\n'), [81092, 42])
  })

  it('accepts only a PiHuo listener owned by this workspace', () => {
    assert.equal(
      isOwnedLegacyApiProcess({
        health: { ok: true, service: 'pihuo-agent-api' },
        listenerPid: 81092,
        command: 'node --import tsx src/http-server.ts',
        cwd: '/repo/packages/pi-runtime',
        expectedMastraRoot: '/repo/packages/pi-runtime',
        expectedPort: 4111,
      }),
      true,
    )
  })

  it('rejects unrelated, mismatched-pid, and other-workspace listeners', () => {
    const base = {
      health: { ok: true, service: 'pihuo-agent-api', pid: 81092, port: 4111 },
      listenerPid: 81092,
      command: 'node --import tsx src/http-server.ts',
      cwd: '/repo/packages/pi-runtime',
      expectedMastraRoot: '/repo/packages/pi-runtime',
      expectedPort: 4111,
    }
    assert.equal(
      isOwnedLegacyApiProcess({
        ...base,
        health: { ok: true, service: 'unrelated' },
      }),
      false,
    )
    assert.equal(isOwnedLegacyApiProcess({ ...base, listenerPid: 999 }), false)
    assert.equal(isOwnedLegacyApiProcess({ ...base, cwd: '/other/packages/pi-runtime' }), false)
    assert.equal(isOwnedLegacyApiProcess({ ...base, command: 'python server.py' }), false)
  })
})

describe('desktop API window lifecycle', () => {
  it('keeps the API alive when the last macOS window closes', () => {
    assert.equal(shouldStopApiOnAllWindowsClosed('darwin'), false)
  })

  it('stops the API before quitting on non-macOS platforms', () => {
    assert.equal(shouldStopApiOnAllWindowsClosed('linux'), true)
    assert.equal(shouldStopApiOnAllWindowsClosed('win32'), true)
  })

  it('waits for an owned API exactly once during app quit', () => {
    assert.equal(shouldWaitForOwnedApiOnQuit(true, false), true)
    assert.equal(shouldWaitForOwnedApiOnQuit(false, false), false)
    assert.equal(shouldWaitForOwnedApiOnQuit(true, true), false)
  })
})

describe('desktop API restart coordination', () => {
  it('serializes restart tasks and continues after a rejected task', async () => {
    const run = createSerialTaskRunner()
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const task = (name: string, fail = false) =>
      run(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        order.push(`${name}:start`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        order.push(`${name}:end`)
        if (fail) throw new Error(name)
        return name
      })

    const results = await Promise.allSettled([task('one', true), task('two'), task('three')])
    assert.equal(maxActive, 1)
    assert.deepEqual(order, [
      'one:start',
      'one:end',
      'two:start',
      'two:end',
      'three:start',
      'three:end',
    ])
    assert.equal(results[0]?.status, 'rejected')
    assert.equal(results[1]?.status, 'fulfilled')
    assert.equal(results[2]?.status, 'fulfilled')
  })

  it('reuses a verified external API only for readiness, never to claim settings applied', () => {
    assert.equal(allowsExistingApiReuse('ensure'), true)
    assert.equal(allowsExistingApiReuse('apply-settings'), false)
  })

  it('identifies watch supervisors that would respawn a killed API child', () => {
    // tsx watch / nodemon / pm2 with a `watch` arg are supervisors.
    assert.equal(
      isWatchSupervisor('node /repo/node_modules/.bin/tsx watch src/http-server.ts'),
      true,
    )
    assert.equal(isWatchSupervisor('nodemon --watch src server.js'), true)
    assert.equal(isWatchSupervisor('pm2 start watch app.js'), true)
    // Plain node/http-server (no supervisor, no watch) is NOT a supervisor.
    assert.equal(isWatchSupervisor('node --import tsx src/http-server.ts'), false)
    // tsx without `watch` is a one-shot runner, not a supervisor.
    assert.equal(isWatchSupervisor('tsx src/http-server.ts'), false)
    // Unrelated command.
    assert.equal(isWatchSupervisor('git status'), false)
  })
})
