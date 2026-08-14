import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPackagedSmoke,
  resolvePackagedSmokeUserDataPath,
  runPackagedSmoke,
  shouldCreateDesktopWindow,
} from './packaged-smoke.js'

describe('packaged desktop smoke mode', () => {
  it('recognizes the hidden smoke argument and suppresses the window', () => {
    assert.equal(isPackagedSmoke(['electron', '--packaged-smoke']), true)
    assert.equal(isPackagedSmoke(['electron']), false)
    assert.equal(shouldCreateDesktopWindow({ packagedSmoke: true }), false)
    assert.equal(shouldCreateDesktopWindow({ packagedSmoke: false }), true)
  })

  it('isolates smoke state from the real desktop profile', () => {
    assert.equal(
      resolvePackagedSmokeUserDataPath({
        packagedSmoke: true,
        temporaryDirectory: '/tmp',
        pid: 4242,
      }),
      '/tmp/pihuo-agent-packaged-smoke-4242',
    )
    assert.equal(
      resolvePackagedSmokeUserDataPath({
        packagedSmoke: false,
        temporaryDirectory: '/tmp',
        pid: 4242,
      }),
      undefined,
    )
  })

  it('starts, verifies, and stops the packaged API', async () => {
    const calls: string[] = []
    const code = await runPackagedSmoke({
      startApi: async () => {
        calls.push('start')
        return true
      },
      stopApi: async () => {
        calls.push('stop')
        return true
      },
      log: (message) => calls.push(message),
    })

    assert.equal(code, 0)
    assert.deepEqual(calls, ['start', 'Packaged API ready', 'stop', 'Packaged API stopped'])
  })

  it('fails without attempting stop when API readiness fails', async () => {
    let stopped = false
    const code = await runPackagedSmoke({
      startApi: async () => false,
      stopApi: async () => {
        stopped = true
        return true
      },
      log: () => {},
    })

    assert.equal(code, 1)
    assert.equal(stopped, false)
  })

  it('fails when the API cannot be stopped safely', async () => {
    const code = await runPackagedSmoke({
      startApi: async () => true,
      stopApi: async () => false,
      log: () => {},
    })

    assert.equal(code, 1)
  })
})
