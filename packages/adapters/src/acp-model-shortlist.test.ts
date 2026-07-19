import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeShortlistedModels } from './acp-model-shortlist.js'
import type { WorkerModelOption } from '@router-agents/shared'

const ZEN_FREE = ['opencode/big-pickle', 'opencode/deepseek-v4-flash-free', 'opencode/hy3-free']

function makeModel(modelId: string, name?: string): WorkerModelOption {
  return { modelId, name: name ?? modelId }
}

describe('computeShortlistedModels', () => {
  it('shortlists pinned model first with reason pinned', () => {
    const allModels = [
      makeModel('openai/gpt-4'),
      makeModel('openai/gpt-4o-mini'),
      makeModel('deepseek/deepseek-chat'),
    ]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: 'openai/gpt-4o-mini',
      zenFreeModels: ZEN_FREE,
      opencodeEnv: { OPENAI_API_KEY: 'sk-xxx' },
    })

    assert.equal(r.shortlist[0]!.modelId, 'openai/gpt-4o-mini')
    assert.equal(r.shortlist[0]!.reason, 'pinned')
    assert.ok(r.shortlist.some((e) => e.reason === 'direct_provider'))
    assert.equal(r.totalModelCount, 3)
    assert.equal(r.openRouterModels.length, 0)
    assert.equal(r.remainingModels.length, 1)
    assert.equal(r.remainingModels[0]!.modelId, 'deepseek/deepseek-chat')
  })

  it('includes zen free models present in allModels as zen_free', () => {
    const allModels = [
      makeModel('opencode/big-pickle'),
      makeModel('opencode/deepseek-v4-flash-free'),
      makeModel('opencode/hy3-free'),
      makeModel('openai/gpt-4'),
    ]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: {},
    })

    assert.equal(r.shortlist.length, 3)
    for (const e of r.shortlist) {
      assert.equal(e.reason, 'zen_free')
    }
    assert.equal(r.openRouterModels.length, 0)
    assert.equal(r.remainingModels.length, 1)
  })

  it('does not shortlist opencode paid models when provider is free-only', () => {
    const allModels = [
      makeModel('opencode/big-pickle'),
      makeModel('opencode/paid-not-on-allowlist'),
    ]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: {},
    })
    assert.deepEqual(
      r.shortlist.map((e) => e.modelId),
      ['opencode/big-pickle'],
    )
    assert.ok(r.remainingModels.some((m) => m.modelId === 'opencode/paid-not-on-allowlist'))
  })

  it('excludes zen free models not in allModels', () => {
    const allModels = [makeModel('opencode/big-pickle')]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: {},
    })

    assert.equal(r.shortlist.length, 1)
    assert.equal(r.shortlist[0]!.modelId, 'opencode/big-pickle')
  })

  it('groups openrouter models separately and keeps them out of shortlist', () => {
    const allModels = [
      makeModel('openrouter/anthropic/claude-sonnet'),
      makeModel('openrouter/google/gemini-pro'),
      makeModel('opencode/big-pickle'),
      makeModel('openai/gpt-4'),
    ]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: { OPENAI_API_KEY: 'sk-xxx', OPENROUTER_API_KEY: 'or-xxx' },
    })

    assert.equal(r.shortlist.length, 2)
    assert.equal(r.openRouterModels.length, 2)
    assert.equal(r.openRouterModels[0]!.modelId, 'openrouter/anthropic/claude-sonnet')
    assert.equal(r.openRouterModels[1]!.modelId, 'openrouter/google/gemini-pro')
    assert.equal(r.remainingModels.length, 0)
    assert.ok(r.searchIndex?.some((m) => m.modelId.startsWith('openrouter/')))
  })

  it('places direct provider models with api key in shortlist as direct_provider', () => {
    const allModels = [makeModel('anthropic/claude-opus-4-8'), makeModel('google/gemini-3.5-flash')]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: { ANTHROPIC_API_KEY: 'sk-ant-xxx' },
    })

    assert.equal(r.shortlist.length, 1)
    assert.equal(r.shortlist[0]!.modelId, 'anthropic/claude-opus-4-8')
    assert.equal(r.shortlist[0]!.reason, 'direct_provider')
    assert.equal(r.remainingModels.length, 1)
    assert.equal(r.remainingModels[0]!.modelId, 'google/gemini-3.5-flash')
  })

  it('excludes unknown custom providers from default shortlist', () => {
    const allModels = [
      makeModel('opencode-go/deepseek-v4'),
      makeModel('siliconflow/deepseek-chat'),
      makeModel('opencode/big-pickle'),
    ]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: {},
    })

    assert.equal(r.shortlist.length, 1)
    assert.equal(r.shortlist[0]!.modelId, 'opencode/big-pickle')
    assert.equal(r.remainingModels.length, 2)
  })

  it('returns empty shortlist for empty allModels', () => {
    const r = computeShortlistedModels({
      allModels: [],
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: {},
    })

    assert.equal(r.shortlist.length, 0)
    assert.equal(r.openRouterModels.length, 0)
    assert.equal(r.remainingModels.length, 0)
    assert.equal(r.totalModelCount, 0)
  })

  it('assigns group field on all models in place', () => {
    const allModels = [
      makeModel('opencode/big-pickle'),
      makeModel('openrouter/foo/bar'),
      makeModel('deepseek/deepseek-chat'),
    ]
    computeShortlistedModels({
      allModels,
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: {},
    })

    assert.equal(allModels[0]!.group, 'shortlist')
    assert.equal(allModels[1]!.group, 'openrouter')
    assert.equal(allModels[2]!.group, 'other')
  })

  it('deduplicates models with same modelId', () => {
    const allModels = [
      makeModel('openai/gpt-4'),
      makeModel('openai/gpt-4'),
      makeModel('openai/gpt-4'),
    ]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: null,
      zenFreeModels: ZEN_FREE,
      opencodeEnv: { OPENAI_API_KEY: 'sk-xxx' },
    })

    assert.equal(r.shortlist.length, 1)
    assert.equal(r.totalModelCount, 3)
  })

  it('handles pinned model that is also in zen free list', () => {
    const allModels = [makeModel('opencode/big-pickle')]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: 'opencode/big-pickle',
      zenFreeModels: ZEN_FREE,
      opencodeEnv: {},
    })

    assert.equal(r.shortlist.length, 1)
    assert.equal(r.shortlist[0]!.reason, 'pinned')
  })

  it('handles pinned openrouter model when authenticated', () => {
    const allModels = [makeModel('openrouter/anthropic/claude-sonnet')]
    const r = computeShortlistedModels({
      allModels,
      pinnedModel: 'openrouter/anthropic/claude-sonnet',
      zenFreeModels: ZEN_FREE,
      opencodeEnv: { OPENROUTER_API_KEY: 'or-xxx' },
    })

    assert.equal(r.shortlist.length, 1)
    assert.equal(r.shortlist[0]!.reason, 'pinned')
    assert.equal(r.openRouterModels.length, 0)
  })
})
