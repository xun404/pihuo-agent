import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyDetectionToWorkers, detectAcpWorkers, whichSync } from './detect-workers.js'

describe('detect-workers', () => {
  it('whichSync finds node when on PATH', () => {
    const node = whichSync('node')
    assert.ok(node, 'expected node on PATH in test env')
  })

  it('detectAcpWorkers returns three core candidates', async () => {
    const list = await detectAcpWorkers()
    assert.equal(list.length, 3)
    assert.deepEqual(list.map((c) => c.kind).sort(), ['claude', 'codex', 'opencode'])
  })

  it('applyDetectionToWorkers enables installed kinds', () => {
    const candidates = [
      {
        kind: 'opencode' as const,
        name: 'OpenCode',
        installed: true,
        detectVia: 'path' as const,
        command: 'opencode',
        args: ['acp'],
        primaryRole: 'general' as const,
        roles: ['general' as const],
        description: 'x',
        installHint: 'ok',
      },
      {
        kind: 'claude' as const,
        name: 'Claude Code',
        installed: false,
        detectVia: 'missing' as const,
        command: 'npx',
        args: ['-y', 'x'],
        primaryRole: 'coder' as const,
        roles: ['coder' as const],
        description: 'x',
        installHint: 'install',
      },
    ]
    const existing = [
      {
        id: 'w1',
        name: 'OpenCode',
        kind: 'opencode' as const,
        command: 'opencode',
        args: ['acp'],
        primaryRole: 'general' as const,
        roles: ['general' as const],
        capabilities: ['general' as const],
        enabled: false,
        scope: 'global' as const,
        health: 'unknown' as const,
        description: '',
      },
    ]
    const res = applyDetectionToWorkers(existing as never, candidates, {
      createMissing: false,
    })
    assert.equal(res.workers[0]!.enabled, true)
    assert.ok(res.enabled.includes('w1'))
    assert.equal(res.recommended.length, 1)
  })
})
