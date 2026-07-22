/**
 * Live debug tests for OpenCode ACP.
 * Run: ACP_LIVE_TESTS=1 node --import tsx --test packages/adapters/src/opencode-acp.test.ts
 *
 * Skips automatically when `opencode` is not on PATH or ACP_LIVE_TESTS is not set.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { whichSync } from './which.js'
import {
  pickOpenCodeAcpModel,
  prepareOpenCodeAcpEnv,
  OPENCODE_SAFE_DEFAULT_MODEL,
  ModelEligibilityError,
} from './opencode-acp-env.js'
import { listAcpModels, runAcpTask } from './acp-runner.js'

const hasOpenCode = Boolean(whichSync('opencode'))
const liveEnabled = process.env.ACP_LIVE_TESTS === '1'

const CANDIDATES = [
  { modelId: 'opencode/big-pickle', name: 'Big Pickle' },
  { modelId: 'openai/gpt-4o', name: 'GPT-4o' },
  { modelId: 'openrouter/meta/llama', name: 'Llama' },
  { modelId: 'glm-coding-plan/glm-5.2', name: 'GLM' },
]

describe('opencode-acp-env unit', () => {
  it('defaults to safe zen model when no pin', () => {
    assert.equal(pickOpenCodeAcpModel({}), OPENCODE_SAFE_DEFAULT_MODEL)
  })

  it('keeps opencode/ free models without candidates', () => {
    assert.equal(pickOpenCodeAcpModel({ pinned: 'opencode/big-pickle' }), 'opencode/big-pickle')
  })

  it('does not silently remap authenticated pin to big-pickle', () => {
    const model = pickOpenCodeAcpModel({
      pinned: 'openai/gpt-4o',
      candidates: CANDIDATES,
      providers: { openai: 'authenticated', opencode: 'free' },
      zenFreeAllowlist: ['opencode/big-pickle'],
    })
    assert.equal(model, 'openai/gpt-4o')

    const prep = prepareOpenCodeAcpEnv({
      baseEnv: { ...process.env, HOME: process.env.HOME },
      model: 'openai/gpt-4o',
      candidates: CANDIDATES,
      providers: { openai: 'authenticated', opencode: 'free' },
      zenFreeAllowlist: ['opencode/big-pickle'],
    })
    assert.equal(prep.configModel, 'openai/gpt-4o')
  })

  it('throws MODEL_PROVIDER_UNAVAILABLE when pin provider disabled', () => {
    assert.throws(
      () =>
        pickOpenCodeAcpModel({
          pinned: 'openai/gpt-4o',
          candidates: CANDIDATES,
          providers: { openai: 'disabled', opencode: 'free' },
          zenFreeAllowlist: ['opencode/big-pickle'],
        }),
      (err: unknown) => {
        assert.ok(err instanceof ModelEligibilityError)
        assert.equal(err.errorCode, 'MODEL_PROVIDER_UNAVAILABLE')
        return true
      },
    )
  })

  it('throws MODEL_NOT_IN_CANDIDATES for unknown pin when candidates provided', () => {
    assert.throws(
      () =>
        pickOpenCodeAcpModel({
          pinned: 'nonexistent/model-not-in-options',
          candidates: CANDIDATES,
          providers: { opencode: 'free' },
          zenFreeAllowlist: ['opencode/big-pickle'],
        }),
      (err: unknown) => {
        assert.ok(err instanceof ModelEligibilityError)
        assert.equal(err.errorCode, 'MODEL_NOT_IN_CANDIDATES')
        return true
      },
    )
  })

  it('throws for ineligible custom pin without diagnostic override', () => {
    assert.throws(
      () =>
        pickOpenCodeAcpModel({
          pinned: 'glm-coding-plan/glm-5.2',
          candidates: CANDIDATES,
          providers: { 'glm-coding-plan': 'unknown', opencode: 'free' },
          zenFreeAllowlist: ['opencode/big-pickle'],
        }),
      (err: unknown) => {
        assert.ok(err instanceof ModelEligibilityError)
        assert.equal(err.errorCode, 'MODEL_SELECTION_UNVERIFIED')
        return true
      },
    )
  })

  it('allowOverride bypasses eligibility for diagnostics', () => {
    assert.equal(
      pickOpenCodeAcpModel({
        pinned: 'glm-coding-plan/glm-5.2',
        candidates: CANDIDATES,
        providers: { 'glm-coding-plan': 'unknown', opencode: 'free' },
        zenFreeAllowlist: ['opencode/big-pickle'],
        allowOverride: true,
      }),
      'glm-coding-plan/glm-5.2',
    )
  })

  it('prepareOpenCodeAcpEnv isolates HOME and drops CONFIG_CONTENT', () => {
    const prep = prepareOpenCodeAcpEnv({
      baseEnv: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: '{"server":{"port":8081}}',
        HOME: process.env.HOME,
      },
      model: null,
    })
    assert.notEqual(prep.env.HOME, process.env.HOME)
    assert.equal(prep.env.OPENCODE_CONFIG_CONTENT, undefined)
    assert.equal(prep.configModel, OPENCODE_SAFE_DEFAULT_MODEL)
    assert.ok(prep.env.OPENCODE_CONFIG?.includes('opencode.json'))
  })

  it('keeps pin as-is when candidates are not provided at execute time', () => {
    assert.equal(pickOpenCodeAcpModel({ pinned: 'openai/gpt-4o' }), 'openai/gpt-4o')
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
    assert.ok((listed.models?.length ?? 0) > 0)
    assert.ok(listed.models!.some((m) => m.modelId.startsWith('opencode/')))
  })

  it('runAcpTask replies under isolated config (no ServeError)', { timeout: 120_000 }, async () => {
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
  })

  it('runAcpTask rejects model not in configOptions', { timeout: 60000 }, async () => {
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
        model: 'nonexistent/model-not-in-options',
        env: {},
      },
      'Reply with exactly one word: pong',
    )
    assert.equal(r.ok, false, 'should reject invalid model pin')
    assert.match(
      r.error ?? '',
      /not in the agent.*available|MODEL_NOT_IN_CANDIDATES|MODEL_SELECTION_UNVERIFIED/i,
    )
  })
})
