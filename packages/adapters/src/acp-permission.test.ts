import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapPermissionRequest, type AcpPermissionRequest } from './acp-session.js'

function fakeParams(
  toolCallOverrides: Record<string, unknown> = {},
  optionsOverrides: Record<string, unknown>[] = [],
) {
  return {
    sessionId: 'sess-1',
    toolCall: {
      toolCallId: 'tool-1',
      ...toolCallOverrides,
    },
    options: [
      { optionId: 'opt-1', name: 'Allow', kind: 'allow_once' as const },
      ...optionsOverrides,
    ],
  }
}

describe('mapPermissionRequest', () => {
  it('passes all fields through correctly from a full RequestPermissionRequest', () => {
    const params = fakeParams(
      {
        kind: 'read',
        title: 'Read file /etc/hosts',
        locations: [
          { path: '/etc/hosts', line: 42 },
          { path: '/etc/hosts', line: 7 },
        ],
      },
      [{ optionId: 'opt-2', name: 'Allow Always', kind: 'allow_always' }],
    )

    const result = mapPermissionRequest(params as any)

    assert.equal(result.toolCallId, 'tool-1')
    assert.equal(result.kind, 'read')
    assert.equal(result.title, 'Read file /etc/hosts')
    assert.deepStrictEqual(result.locations, [
      { path: '/etc/hosts', line: 42 },
      { path: '/etc/hosts', line: 7 },
    ])
    assert.equal(result.options.length, 2)
    assert.deepStrictEqual(result.options[0], {
      optionId: 'opt-1',
      name: 'Allow',
      kind: 'allow_once',
    })
    assert.deepStrictEqual(result.options[1], {
      optionId: 'opt-2',
      name: 'Allow Always',
      kind: 'allow_always',
    })
  })

  it('does NOT include rawInput or rawOutput in the callback envelope', () => {
    const params = fakeParams({
      rawInput: { huge: 'payload' },
      rawOutput: { secret: 'data' },
    })

    const result = mapPermissionRequest(params as any)
    assert.ok(!('rawInput' in result))
    assert.ok(!('rawOutput' in result))
    assert.ok(!('rawInput' in (result as any)))
    assert.ok(!('rawOutput' in (result as any)))
  })

  it('provides fallback text for missing title', () => {
    const params = fakeParams({ title: undefined })
    const result = mapPermissionRequest(params as any)
    assert.ok(typeof result.title === 'string')
    assert.ok(result.title!.length > 0)
  })

  it('provides fallback text for null title', () => {
    const params = fakeParams({ title: null })
    const result = mapPermissionRequest(params as any)
    assert.ok(typeof result.title === 'string')
    assert.ok(result.title!.length > 0)
  })

  it('provides fallback text for empty string title', () => {
    const params = fakeParams({ title: '' })
    const result = mapPermissionRequest(params as any)
    assert.ok(typeof result.title === 'string')
    assert.ok(result.title!.length > 0)
  })

  it('normalizes missing kind to "other"', () => {
    const params = fakeParams({ kind: undefined })
    const result = mapPermissionRequest(params as any)
    assert.equal(result.kind, 'other')
  })

  it('normalizes null kind to "other"', () => {
    const params = fakeParams({ kind: null })
    const result = mapPermissionRequest(params as any)
    assert.equal(result.kind, 'other')
  })

  it('normalizes empty string kind to "other"', () => {
    const params = fakeParams({ kind: '' })
    const result = mapPermissionRequest(params as any)
    assert.equal(result.kind, 'other')
  })

  it('discards locations with invalid line numbers (NaN)', () => {
    const params = fakeParams({
      locations: [
        { path: '/a', line: Number.NaN },
        { path: '/b', line: 5 },
      ],
    })

    const result = mapPermissionRequest(params as any)
    assert.equal(result.locations!.length, 2)
    assert.deepStrictEqual(result.locations![0], { path: '/a' })
    assert.deepStrictEqual(result.locations![1], { path: '/b', line: 5 })
  })

  it('discards locations with negative line numbers', () => {
    const params = fakeParams({
      locations: [
        { path: '/a', line: -1 },
        { path: '/b', line: 3 },
      ],
    })

    const result = mapPermissionRequest(params as any)
    assert.equal(result.locations!.length, 2)
    assert.deepStrictEqual(result.locations![0], { path: '/a' })
    assert.deepStrictEqual(result.locations![1], { path: '/b', line: 3 })
  })

  it('discards locations with non-finite line numbers', () => {
    const params = fakeParams({
      locations: [
        { path: '/a', line: Infinity },
        { path: '/b', line: 10 },
      ],
    })

    const result = mapPermissionRequest(params as any)
    assert.equal(result.locations!.length, 2)
    assert.deepStrictEqual(result.locations![0], { path: '/a' })
    assert.deepStrictEqual(result.locations![1], { path: '/b', line: 10 })
  })

  it('keeps locations with line 0 (valid line number)', () => {
    const params = fakeParams({
      locations: [
        { path: '/a', line: 0 },
        { path: '/b', line: 1 },
      ],
    })

    const result = mapPermissionRequest(params as any)
    assert.equal(result.locations!.length, 2)
    assert.deepStrictEqual(result.locations![0], { path: '/a', line: 0 })
    assert.deepStrictEqual(result.locations![1], { path: '/b', line: 1 })
  })

  it('handles null/undefined locations as empty', () => {
    const params = fakeParams({ locations: null })
    const result = mapPermissionRequest(params as any)
    assert.deepStrictEqual(result.locations, [])

    const params2 = fakeParams({ locations: undefined })
    const result2 = mapPermissionRequest(params2 as any)
    assert.deepStrictEqual(result2.locations, [])
  })

  it('handles missing toolCallId gracefully', () => {
    const params = {
      sessionId: 'sess-1',
      toolCall: {},
      options: [{ optionId: 'opt-1', name: 'Allow', kind: 'allow_once' }],
    }
    const result = mapPermissionRequest(params as any)
    assert.equal(result.toolCallId, undefined)
  })

  it('does not pass through unknown top-level keys', () => {
    const params = {
      sessionId: 'sess-1',
      toolCall: { toolCallId: 'tool-1', _meta: { secret: 'value' } },
      options: [{ optionId: 'opt-1', name: 'Allow', kind: 'allow_once' }],
      unknownField: 'should not appear',
    }
    const result = mapPermissionRequest(params as any)
    const keys = Object.keys(result as unknown as Record<string, unknown>)
    assert.ok(!keys.includes('unknownField'))
    assert.ok(!keys.includes('sessionId'))
    assert.ok(!keys.includes('_meta'))
  })

  it('AcpPermissionRequest type has the correct shape', () => {
    const req: AcpPermissionRequest = {
      toolCallId: 't1',
      kind: 'read',
      title: 'Test',
      locations: [{ path: '/file', line: 1 }],
      options: [{ optionId: 'o1', name: 'Yes', kind: 'allow_once' }],
    }
    assert.equal(req.toolCallId, 't1')
    assert.equal(req.kind, 'read')
    assert.equal(req.title, 'Test')
    assert.equal(req.locations![0].path, '/file')
    assert.equal(req.locations![0].line, 1)
    assert.equal(req.options[0].optionId, 'o1')
    assert.equal(req.options[0].name, 'Yes')
    assert.equal(req.options[0].kind, 'allow_once')
  })

  describe('strict approval options', () => {
    it('rejects missing or empty options', () => {
      const base = { sessionId: 'sess-1', toolCall: { toolCallId: 'tool-1' } }
      assert.throws(() => mapPermissionRequest(base as any), /invalid approval options/i)
      assert.throws(
        () => mapPermissionRequest({ ...base, options: [] } as any),
        /invalid approval options/i,
      )
      assert.throws(
        () => mapPermissionRequest({ ...base, options: null } as any),
        /invalid approval options/i,
      )
    })

    it('rejects blank ids, blank names, missing/unknown kinds, and duplicate ids', () => {
      const base = { sessionId: 'sess-1', toolCall: { toolCallId: 'tool-1' } }
      for (const options of [
        [{ optionId: '', name: 'Allow', kind: 'allow_once' }],
        [{ optionId: 'a', name: '', kind: 'allow_once' }],
        [{ optionId: 'a', name: 'Allow' }],
        [{ optionId: 'a', name: 'Allow', kind: 'sometimes' }],
        [
          { optionId: 'a', name: 'Allow', kind: 'allow_once' },
          { optionId: 'a', name: 'Again', kind: 'allow_always' },
        ],
      ]) {
        assert.throws(
          () => mapPermissionRequest({ ...base, options } as any),
          /invalid approval options/i,
        )
      }
    })
  })
})
