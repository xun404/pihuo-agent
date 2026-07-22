import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { whichSync } from './which.js'
import { listAcpModels } from './acp-runner.js'

const hasClaude = Boolean(whichSync('claude'))
const liveEnabled = process.env.ACP_LIVE_TESTS === '1'

describe('acp-live Claude smoke', { skip: !(hasClaude && liveEnabled) }, () => {
  const baseEnv = { ...process.env } as Record<string, string>

  it('listAcpModels for Claude returns configOptions', { timeout: 90000 }, async () => {
    const result = await listAcpModels(
      {
        id: 't-claude-smoke',
        name: 'Claude Code',
        command: 'npx',
        args: ['-y', '@agentclientprotocol/claude-agent-acp@latest'],
        kind: 'claude',
        env: baseEnv,
      },
      { cwd: process.cwd(), timeoutMs: 80000 },
    )
    if (!result.ok) {
      console.error('Claude models error:', result.error)
    }
    assert.ok(result.ok, result.error)
    assert.ok(result.models.length > 0, 'Should return some models from configOptions')
  })
})
