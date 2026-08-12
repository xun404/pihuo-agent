import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { match } from './route-match.js'

describe('Owner route matcher', () => {
  it('matches exact paths and decodes named parameters', () => {
    assert.deepEqual(match('/api/workers/a%20worker/models', '/api/workers/:id/models'), {
      id: 'a worker',
    })
    assert.equal(match('/api/workers/a/models/extra', '/api/workers/:id/models'), null)
    assert.equal(match('/api/projects/a', '/api/workers/:id/models'), null)
  })

  it('treats malformed percent escapes as an unmatched route', () => {
    assert.equal(match('/api/workers/%E0%A4/models', '/api/workers/:id/models'), null)
  })
})
