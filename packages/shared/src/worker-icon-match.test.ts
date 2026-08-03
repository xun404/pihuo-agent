import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchRegistryAgentForIcon } from './worker-icon-match.js'

const agents = [
  { id: 'claude-acp', name: 'Claude Agent' },
  { id: 'codex-acp', name: 'Codex' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'gemini-cli', name: 'Gemini CLI' },
]

describe('matchRegistryAgentForIcon', () => {
  it('matches by command containing agent id', () => {
    assert.equal(
      matchRegistryAgentForIcon('My Agent', '/opt/bin/claude-acp', agents),
      'claude-acp',
    )
  })

  it('matches by display name / name substring', () => {
    assert.equal(matchRegistryAgentForIcon('Claude Code', 'agent', agents), 'claude-acp')
    assert.equal(matchRegistryAgentForIcon('codex', 'run', agents), 'codex-acp')
  })

  it('matches by token overlap', () => {
    assert.equal(
      matchRegistryAgentForIcon('My Open Code', '/usr/local/bin/oc', agents),
      'opencode',
    )
  })

  it('returns undefined when nothing matches', () => {
    assert.equal(matchRegistryAgentForIcon('Mystery', 'xyz-cli', agents), undefined)
  })

  it('returns undefined for empty catalog', () => {
    assert.equal(matchRegistryAgentForIcon('Claude', 'claude', []), undefined)
  })
})
