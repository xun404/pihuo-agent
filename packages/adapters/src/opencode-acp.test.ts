/**
 * Live debug tests for OpenCode ACP.
 * Run: ACP_LIVE_TESTS=1 node --import tsx --test packages/adapters/src/opencode-acp.test.ts
 *
 * Skips automatically when `opencode` is not on PATH or ACP_LIVE_TESTS is not set.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { whichSync } from './detect-workers.js'
import {
  pickOpenCodeAcpModel,
  prepareOpenCodeAcpEnv,
  OPENCODE_SAFE_DEFAULT_MODEL,
} from './opencode-acp-env.js'
import { listAcpModels, runAcpTask } from './acp-runner.js'

const hasOpenCode = Boolean(whichSync('opencode'))
const liveEnabled = process.env.ACP_LIVE_TESTS === '1'

describe('opencode-acp-env unit', () => {
  it('remaps disabled glm pin to safe Zen default', () => {
    assert.equal(pickOpenCodeAcpModel('glm-coding-plan/glm-5.2'), OPENCODE_SAFE_DEFAULT_MODEL)
  })

  it('keeps opencode/ free models', () => {
    assert.equal(pickOpenCodeAcpModel('opencode/big-pickle'), 'opencode/big-pickle')
  })

  it('prepareOpenCodeAcpEnv isolates HOME and drops CONFIG_CONTENT', () => {
    const prep = prepareOpenCodeAcpEnv({
      baseEnv: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: '{"server":{"port":8081}}',
        HOME: process.env.HOME,
      },
      model: 'glm-coding-plan/glm-5.2',
    })
    assert.notEqual(prep.env.HOME, process.env.HOME)
    assert.equal(prep.env.OPENCODE_CONFIG_CONTENT, undefined)
    assert.equal(prep.configModel, OPENCODE_SAFE_DEFAULT_MODEL)
    assert.ok(prep.env.OPENCODE_CONFIG?.includes('opencode.json'))
  })
})

describe('opencode-acp live', { skip: !(hasOpenCode && liveEnabled) }, () => {
  it('listAcpModels uses ACP configOptions (stable session config, not CLI)', async () => {
    const listed = await listAcpModels(
      {
        id: 't-oc',
        name: 'OpenCode',
        command: 'opencode',
        args: ['acp'],
        kind: 'opencode',
        env: {},
      },
      { cwd: process.cwd(), timeoutMs: 60_000 },
    )
    assert.equal(listed.ok, true)
    // Real installs with providers >> Zen free 5–6; still ok if only Zen
    assert.ok((listed.models?.length ?? 0) > 0)
    assert.ok(listed.models!.some((m) => m.modelId.startsWith('opencode/')))
  })

  it(
    'runAcpTask replies under isolated config (no ServeError)',
    { timeout: 120_000 },
    async () => {
      const r = await runAcpTask(
        {
          command: 'opencode',
          args: ['acp'],
          cwd: process.cwd(),
          workerId: 't-oc-run',
          workerName: 'OpenCode',
          kind: 'opencode',
          primaryRole: 'general',
          roles: ['general'],
          model: undefined,
          env: {},
        },
        'Reply with exactly one word: pong',
      )
      if (!r.ok) {
        console.error('ACP failed:', r.error)
      }
      assert.equal(r.ok, true, r.error)
      assert.match((r.output ?? '').toLowerCase(), /pong/)
    },
  )

  it(
    'runAcpTask rejects model not in configOptions',
    { timeout: 60000 },
    async () => {
      const r = await runAcpTask(
        {
          command: 'opencode',
          args: ['acp'],
          cwd: process.cwd(),
          workerId: 't-oc-run-bad',
          workerName: 'OpenCode',
          kind: 'opencode',
          primaryRole: 'general',
          roles: ['general'],
          // intentionally bad pin — must fail explicitly, not silently remap
          model: 'nonexistent/model-not-in-options',
          env: {},
        },
        'Reply with exactly one word: pong',
      )
      assert.equal(r.ok, false, 'should reject invalid model pin')
      assert.match(
        r.error ?? '',
        /not in the agent.*available/i,
      )
    },
  )
})
