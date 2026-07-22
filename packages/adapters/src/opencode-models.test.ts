import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseOpenCodeModelsStdout,
  sortOpenCodeModelIds,
  listOpenCodeModelsViaCli,
} from './opencode-models.js'
import { whichSync } from './which.js'

describe('opencode-models parse/sort', () => {
  it('parses provider/model lines and ignores JSON noise', () => {
    const ids = parseOpenCodeModelsStdout(`
opencode/big-pickle
opencode-go/deepseek-v4-flash
{
  "id": "noise"
}
openrouter/~anthropic/claude-sonnet-latest
not-a-model
`)
    assert.deepEqual(ids, [
      'opencode/big-pickle',
      'opencode-go/deepseek-v4-flash',
      'openrouter/~anthropic/claude-sonnet-latest',
    ])
  })

  it('sorts pinned + zen + auth before openrouter', () => {
    const sorted = sortOpenCodeModelIds(
      ['openrouter/a/x', 'deepseek/chat', 'opencode/big-pickle', 'opencode-go/mimo', 'pinned/me'],
      {
        pinnedModel: 'pinned/me',
        authProviders: new Set(['opencode', 'deepseek', 'opencode-go', 'openrouter']),
        disabledProviders: new Set(),
      },
    )
    assert.equal(sorted[0], 'pinned/me')
    assert.ok(sorted.indexOf('opencode/big-pickle') < sorted.indexOf('deepseek/chat'))
    assert.ok(sorted.indexOf('deepseek/chat') < sorted.indexOf('openrouter/a/x'))
  })
})

const hasOpenCode = Boolean(whichSync('opencode'))
const liveEnabled = process.env.ACP_LIVE_TESTS === '1'

describe('opencode-models live CLI', { skip: !(hasOpenCode && liveEnabled) }, () => {
  it('lists more than Zen free presets', () => {
    const r = listOpenCodeModelsViaCli({ timeoutMs: 60_000 })
    assert.equal(r.ok, true, r.error)
    assert.ok(r.models.length > 5, `expected >5 models, got ${r.models.length}`)
    assert.ok(r.models.some((m) => m.modelId.startsWith('opencode/')))
  })
})
