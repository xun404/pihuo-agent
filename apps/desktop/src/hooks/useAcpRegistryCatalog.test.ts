import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CatalogRequestCoordinator } from './useAcpRegistryCatalog.js'

describe('CatalogRequestCoordinator', () => {
  it('retains one active controller and aborts the superseded request', () => {
    const coordinator = new CatalogRequestCoordinator()
    const first = coordinator.begin()
    const second = coordinator.begin()

    assert.equal(first.controller.signal.aborted, true)
    assert.equal(second.controller.signal.aborted, false)
    assert.equal(coordinator.isCurrent(first), false)
    assert.equal(coordinator.isCurrent(second), true)
  })

  it('cleans up the active StrictMode request and ignores stale completions', () => {
    const coordinator = new CatalogRequestCoordinator()
    const request = coordinator.begin()

    coordinator.abort()

    assert.equal(request.controller.signal.aborted, true)
    assert.equal(coordinator.isCurrent(request), false)
    coordinator.finish(request)
    assert.equal(coordinator.activeSignal, null)
  })

  it('only clears the matching request on completion', () => {
    const coordinator = new CatalogRequestCoordinator()
    const first = coordinator.begin()
    const second = coordinator.begin()

    coordinator.finish(first)
    assert.equal(coordinator.activeSignal, second.controller.signal)
    coordinator.finish(second)
    assert.equal(coordinator.activeSignal, null)
  })
})
