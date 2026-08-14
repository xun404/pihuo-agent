import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import { HttpJsonBodyError, readJsonBody, resolveMaxJsonBodyBytes } from './http-json-body.js'

describe('HTTP JSON body boundary', () => {
  it('parses a bounded JSON stream', async () => {
    const stream = Readable.from([Buffer.from('{"ok":'), Buffer.from('true}')])
    assert.deepEqual(await readJsonBody(stream, 64), { ok: true })
  })

  it('maps malformed JSON to a safe 400 error', async () => {
    await assert.rejects(
      readJsonBody(Readable.from(['{invalid']), 64),
      (error: unknown) =>
        error instanceof HttpJsonBodyError &&
        error.status === 400 &&
        error.code === 'INVALID_JSON_BODY',
    )
  })

  it('rejects oversized input before retaining the remainder', async () => {
    await assert.rejects(
      readJsonBody(Readable.from(['12345', '67890']), 8),
      (error: unknown) =>
        error instanceof HttpJsonBodyError &&
        error.status === 413 &&
        error.code === 'REQUEST_BODY_TOO_LARGE',
    )
  })

  it('normalizes and caps configured limits', () => {
    assert.equal(resolveMaxJsonBodyBytes('0'), 10 * 1024 * 1024)
    assert.equal(resolveMaxJsonBodyBytes('123.9'), 123)
    assert.equal(resolveMaxJsonBodyBytes('999999999'), 64 * 1024 * 1024)
  })
})
