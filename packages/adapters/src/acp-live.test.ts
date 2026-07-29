import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { whichSync } from './which.js'
import { listAcpModels } from './acp-runner.js'
import { listAcpReasoningOptions } from './acp-reasoning-options.js'

const hasClaude = Boolean(whichSync('claude'))
const hasCodex = Boolean(whichSync('codex'))
const hasOpencode = Boolean(whichSync('opencode'))
const liveEnabled = process.env.ACP_LIVE_TESTS === '1'

describe('acp-live Claude smoke', { skip: !(hasClaude && liveEnabled) }, () => {
  const baseEnv = { ...process.env } as Record<string, string>

  it('listAcpModels for Claude returns configOptions', { timeout: 90000 }, async () => {
    const result = await listAcpModels(
      {
        id: 't-claude-smoke',
        name: 'Claude Code',
        command: 'npx',
        args: ['-y', '@agentclientprotocol/claude-agent-acp@0.60.0'],
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

  it(
    'listAcpReasoningOptions for Claude discovers effort reasoning',
    { timeout: 90000 },
    async () => {
      const result = await listAcpReasoningOptions(
        {
          id: 't-claude-smoke-reasoning',
          name: 'Claude Code',
          command: 'npx',
          args: ['-y', '@agentclientprotocol/claude-agent-acp@0.60.0'],
          kind: 'claude',
          env: baseEnv,
        },
        undefined,
        { cwd: process.cwd(), timeoutMs: 80000 },
      )
      if (!result.ok) {
        console.error('Claude reasoning error:', result.error)
      }
      assert.equal(result.supported, true, 'Claude should support reasoning via thought_level')
      assert.ok(result.selector, 'Claude should return a reasoning selector')
      assert.ok(
        result.selector!.configId === 'effort' || result.selector!.configId === 'reasoning_effort',
        `Unexpected configId: ${result.selector?.configId}`,
      )
      assert.ok(result.selector!.options.length > 0, 'Should have reasoning options')
    },
  )
})

describe('acp-live Codex smoke', { skip: !(hasCodex && liveEnabled) }, () => {
  const baseEnv = { ...process.env } as Record<string, string>

  it(
    'listAcpReasoningOptions for Codex discovers reasoning_effort',
    { timeout: 90000 },
    async () => {
      const result = await listAcpReasoningOptions(
        {
          id: 't-codex-smoke-reasoning',
          name: 'Codex',
          command: 'npx',
          args: ['-y', '@agentclientprotocol/codex-acp@1.1.5'],
          kind: 'codex',
          env: baseEnv,
        },
        undefined,
        { cwd: process.cwd(), timeoutMs: 80000 },
      )
      if (!result.ok) {
        console.error('Codex reasoning error:', result.error)
      }
      assert.equal(result.supported, true, 'Codex should support reasoning via thought_level')
      assert.ok(result.selector, 'Codex should return a reasoning selector')
      assert.equal(
        result.selector!.configId,
        'reasoning_effort',
        `Expected reasoning_effort, got: ${result.selector?.configId}`,
      )
      assert.ok(result.selector!.options.length > 0, 'Should have reasoning options')
    },
  )
})

describe('acp-live OpenCode smoke', { skip: !(hasOpencode && liveEnabled) }, () => {
  const baseEnv = { ...process.env } as Record<string, string>

  it('OpenCode without thought_level still works for models', { timeout: 90000 }, async () => {
    const result = await listAcpReasoningOptions(
      {
        id: 't-opencode-smoke',
        name: 'OpenCode',
        command: 'opencode',
        args: ['acp'],
        kind: 'opencode',
        env: baseEnv,
      },
      undefined,
      { cwd: process.cwd(), timeoutMs: 80000 },
    )
    // OpenCode may or may not declare thought_level; the important thing is we don't crash
    console.log(
      'OpenCode reasoning supported:',
      result.supported,
      result.selector ? `configId=${result.selector.configId}` : 'no selector',
    )
    assert.equal(result.ok, true, 'OpenCode discovery should not error')
  })
})
