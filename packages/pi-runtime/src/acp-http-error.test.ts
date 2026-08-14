import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AcpSessionRuntimeError } from '@pihuo-agent/adapters'
import { asAcpHttpFailure } from './acp-http-error.js'

describe('asAcpHttpFailure', () => {
  it('maps typed ACP runtime failures to a stable, redacted 503 response', () => {
    const error = new AcpSessionRuntimeError(
      'catalog_repair_required',
      'ACP session storage is unavailable. Repair the catalog before retrying.',
      false,
      { cause: new Error('private-agent-session-id /secret/workspace') },
    )

    const failure = asAcpHttpFailure(error)

    assert.deepEqual(failure, {
      status: 503,
      body: {
        error: 'ACP session storage is unavailable. Repair the catalog before retrying.',
        code: 'catalog_repair_required',
        canResetAcpContext: false,
      },
    })
    assert.doesNotMatch(JSON.stringify(failure), /private-agent-session-id|secret\/workspace/)
  })

  it('returns undefined for unrelated errors', () => {
    assert.equal(asAcpHttpFailure(new Error('ordinary failure')), undefined)
  })
})
