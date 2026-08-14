import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { matchRegistryAgentForIcon } from '@pihuo-agent/shared'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'WorkerIconPicker.tsx'),
  'utf8',
)

describe('WorkerIconPicker', () => {
  it('auto-matches via shared matchRegistryAgentForIcon and allows user override', () => {
    assert.match(source, /matchRegistryAgentForIcon/)
    assert.match(source, /userPicked/)
    assert.match(source, /iconNone/)
    assert.match(source, /iconAutoMatched/)
  })

  it('defaults Claude-like names to claude-acp from a catalog sample', () => {
    const agents = [
      { id: 'claude-acp', name: 'Claude Agent' },
      { id: 'codex-acp', name: 'Codex' },
    ]
    assert.equal(matchRegistryAgentForIcon('Claude Code', 'claude', agents), 'claude-acp')
  })
})
