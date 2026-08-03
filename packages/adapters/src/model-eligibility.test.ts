import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateModelEligibility,
  buildShortlistAndSearchIndex,
  validateModelPin,
  resolveEligibilityCandidates,
  projectPinIntoAvailableModels,
  buildCurrentEligibilityEvidence,
  type ProviderEvidence,
  type EligibilityInput,
} from './model-eligibility.js'

const candidates = [
  { modelId: 'opencode/big-pickle', name: 'Big Pickle' },
  { modelId: 'openai/gpt-4o', name: 'GPT-4o' },
  { modelId: 'openrouter/meta/llama', name: 'Llama' },
  { modelId: 'custom/foo', name: 'Foo' },
]

function input(
  partial: Partial<EligibilityInput> & Pick<EligibilityInput, 'modelId'>,
): EligibilityInput {
  return {
    candidates,
    zenFreeAllowlist: ['opencode/big-pickle'],
    providers: {
      opencode: 'free',
      openai: 'authenticated',
      openrouter: 'authenticated',
      custom: 'unknown',
    } satisfies Record<string, ProviderEvidence>,
    purpose: 'shortlist',
    ...partial,
  }
}

describe('evaluateModelEligibility', () => {
  it('accepts zen free on allowlist for shortlist', () => {
    const r = evaluateModelEligibility(input({ modelId: 'opencode/big-pickle' }))
    assert.equal(r.eligible, true)
    assert.equal(r.reason, 'zen_free')
  })

  it('accepts authenticated direct provider for shortlist', () => {
    const r = evaluateModelEligibility(input({ modelId: 'openai/gpt-4o' }))
    assert.equal(r.eligible, true)
    assert.equal(r.reason, 'direct_authenticated')
  })

  it('rejects openrouter from default shortlist but allows search', () => {
    const short = evaluateModelEligibility(
      input({ modelId: 'openrouter/meta/llama', purpose: 'shortlist' }),
    )
    assert.equal(short.eligible, false)
    assert.equal(short.errorCode, 'MODEL_OPENROUTER_SEARCH_ONLY')
    const search = evaluateModelEligibility(
      input({ modelId: 'openrouter/meta/llama', purpose: 'search' }),
    )
    assert.equal(search.eligible, true)
    const pin = evaluateModelEligibility(
      input({ modelId: 'openrouter/meta/llama', purpose: 'pin' }),
    )
    assert.equal(pin.eligible, true)
  })

  it('rejects disabled and unknown providers', () => {
    const disabled = evaluateModelEligibility(
      input({ modelId: 'openai/gpt-4o', providers: { openai: 'disabled' } }),
    )
    assert.equal(disabled.eligible, false)
    assert.equal(disabled.errorCode, 'MODEL_PROVIDER_UNAVAILABLE')
    const unknown = evaluateModelEligibility(input({ modelId: 'custom/foo', purpose: 'shortlist' }))
    assert.equal(unknown.eligible, false)
    assert.equal(unknown.errorCode, 'MODEL_SELECTION_UNVERIFIED')
  })

  it('disabled provider overrides the zen free allowlist', () => {
    const disabled = evaluateModelEligibility(
      input({
        modelId: 'opencode/big-pickle',
        providers: { opencode: 'disabled' },
        purpose: 'execute',
      }),
    )
    assert.equal(disabled.eligible, false)
    assert.equal(disabled.errorCode, 'MODEL_PROVIDER_UNAVAILABLE')
  })

  it('rejects models not in ACP candidate set', () => {
    const r = evaluateModelEligibility(input({ modelId: 'openai/not-announced' }))
    assert.equal(r.eligible, false)
    assert.equal(r.errorCode, 'MODEL_NOT_IN_CANDIDATES')
  })

  it('allows openrouter pin and execute when authenticated', () => {
    const exec = evaluateModelEligibility(
      input({ modelId: 'openrouter/meta/llama', purpose: 'execute' }),
    )
    assert.equal(exec.eligible, true)
    assert.equal(exec.reason, 'pinned_openrouter')
  })

  it('does not shortlist non-allowlist opencode models when provider evidence is free', () => {
    const cands = [...candidates, { modelId: 'opencode/paid-not-on-allowlist', name: 'Paid' }]
    const r = evaluateModelEligibility(
      input({
        modelId: 'opencode/paid-not-on-allowlist',
        candidates: cands,
        providers: { opencode: 'free' },
        purpose: 'shortlist',
      }),
    )
    assert.equal(r.eligible, false)
    assert.equal(r.errorCode, 'MODEL_SELECTION_UNVERIFIED')
  })

  it('allows non-allowlist opencode model when provider is authenticated', () => {
    const cands = [...candidates, { modelId: 'opencode/paid-not-on-allowlist', name: 'Paid' }]
    const r = evaluateModelEligibility(
      input({
        modelId: 'opencode/paid-not-on-allowlist',
        candidates: cands,
        providers: { opencode: 'authenticated' },
        purpose: 'shortlist',
      }),
    )
    assert.equal(r.eligible, true)
    assert.equal(r.reason, 'direct_authenticated')
  })
})

describe('validateModelPin', () => {
  it('fails closed when catalog is empty for arbitrary model', () => {
    const r = validateModelPin({
      modelId: 'openai/gpt-4o',
      candidates: [],
      providers: {},
      zenFreeAllowlist: ['opencode/big-pickle'],
    })
    assert.equal(r.ok, false)
    assert.equal(r.errorCode, 'MODEL_REFRESH_FAILED')
  })

  it('allows zen free allowlist pin without catalog', () => {
    const r = validateModelPin({
      modelId: 'opencode/big-pickle',
      candidates: [],
      providers: {},
      zenFreeAllowlist: ['opencode/big-pickle'],
    })
    assert.equal(r.ok, true)
  })

  it('rejects a zen free pin when its provider is explicitly disabled', () => {
    const r = validateModelPin({
      modelId: 'opencode/big-pickle',
      candidates: [],
      providers: { opencode: 'disabled' },
      zenFreeAllowlist: ['opencode/big-pickle'],
    })
    assert.equal(r.ok, false)
    assert.equal(r.errorCode, 'MODEL_PROVIDER_UNAVAILABLE')
  })

  it('uses evaluator when candidates present', () => {
    const r = validateModelPin({
      modelId: 'openai/gpt-4o',
      candidates,
      providers: {
        opencode: 'free',
        openai: 'authenticated',
        openrouter: 'authenticated',
        custom: 'unknown',
      },
      zenFreeAllowlist: ['opencode/big-pickle'],
    })
    assert.equal(r.ok, true)

    const bad = validateModelPin({
      modelId: 'custom/foo',
      candidates,
      providers: {
        opencode: 'free',
        openai: 'authenticated',
        openrouter: 'authenticated',
        custom: 'unknown',
      },
      zenFreeAllowlist: ['opencode/big-pickle'],
    })
    assert.equal(bad.ok, false)
    assert.equal(bad.errorCode, 'MODEL_SELECTION_UNVERIFIED')
  })
})

describe('buildShortlistAndSearchIndex', () => {
  it('puts free and authenticated direct in shortlist; openrouter only in search', () => {
    const { shortlist, searchIndex } = buildShortlistAndSearchIndex({
      candidates,
      providers: {
        opencode: 'free',
        openai: 'authenticated',
        openrouter: 'authenticated',
        custom: 'unknown',
      },
      zenFreeAllowlist: ['opencode/big-pickle'],
    })
    assert.deepEqual(
      shortlist.map((m) => m.modelId).sort(),
      ['opencode/big-pickle', 'openai/gpt-4o'].sort(),
    )
    assert.ok(searchIndex.some((m) => m.modelId === 'openrouter/meta/llama'))
    assert.ok(!shortlist.some((m) => m.modelId === 'openrouter/meta/llama'))
    assert.ok(!searchIndex.some((m) => m.modelId === 'custom/foo'))
  })

  it('includes eligible pin at front of shortlist even if openrouter', () => {
    const { shortlist } = buildShortlistAndSearchIndex({
      candidates,
      providers: {
        opencode: 'free',
        openai: 'authenticated',
        openrouter: 'authenticated',
        custom: 'unknown',
      },
      zenFreeAllowlist: ['opencode/big-pickle'],
      pinnedModel: 'openrouter/meta/llama',
    })
    assert.equal(shortlist[0]?.modelId, 'openrouter/meta/llama')
  })
})

describe('buildCurrentEligibilityEvidence', () => {
  it('does not let live "unknown" clobber catalog "authenticated" (generic ACP workers)', () => {
    const merged = buildCurrentEligibilityEvidence({
      modelIds: ['default', 'sonnet', 'opus[1m]'],
      env: {},
      zenFreeAllowlist: [],
      catalogProviders: {
        default: 'authenticated',
        sonnet: 'authenticated',
        'opus[1m]': 'authenticated',
      },
    })
    assert.equal(merged['default'], 'authenticated')
    assert.equal(merged['sonnet'], 'authenticated')
    assert.equal(merged['opus[1m]'], 'authenticated')
  })

  it('keeps live "disabled" authoritative over catalog', () => {
    const merged = buildCurrentEligibilityEvidence({
      modelIds: ['default'],
      env: {},
      zenFreeAllowlist: [],
      catalogProviders: { default: 'authenticated' },
      disabledProviders: ['default'],
    })
    assert.equal(merged['default'], 'disabled')
  })

  it('elevates live "authenticated" (env key) over catalog "unknown"', () => {
    const merged = buildCurrentEligibilityEvidence({
      modelIds: ['openai/gpt-4o'],
      env: { OPENAI_API_KEY: 'sk-test' },
      zenFreeAllowlist: [],
      catalogProviders: { openai: 'unknown' },
    })
    assert.equal(merged['openai'], 'authenticated')
  })
})

describe('resolveEligibilityCandidates', () => {
  it('prefers catalog searchIndex over worker shortlist', () => {
    const shortlist = [{ modelId: 'opencode/big-pickle', name: 'Big Pickle' }]
    const searchIndex = [
      { modelId: 'opencode/big-pickle', name: 'Big Pickle' },
      { modelId: 'openrouter/meta/llama', name: 'Llama' },
    ]
    const r = resolveEligibilityCandidates({ availableModels: shortlist }, { searchIndex })
    assert.ok(r)
    assert.equal(r.length, 2)
    assert.ok(r.some((m) => m.modelId === 'openrouter/meta/llama'))
  })

  it('falls back to availableModels when catalog missing; empty searchIndex is fail-closed', () => {
    const shortlist = [{ modelId: 'opencode/big-pickle', name: 'Big Pickle' }]
    assert.deepEqual(
      resolveEligibilityCandidates({ availableModels: shortlist }, undefined)?.map(
        (m) => m.modelId,
      ),
      ['opencode/big-pickle'],
    )
    // Explicit empty searchIndex must NOT fall back to shortlist (execute fail-closed)
    assert.deepEqual(
      resolveEligibilityCandidates({ availableModels: shortlist }, { searchIndex: [] })?.map(
        (m) => m.modelId,
      ),
      [],
    )
  })

  it('returns undefined when catalog absent and no shortlist; empty arrays stay empty', () => {
    assert.equal(resolveEligibilityCandidates({}, null), undefined)
    assert.deepEqual(resolveEligibilityCandidates({ availableModels: [] }, { searchIndex: [] }), [])
  })

  it('lets openrouter pin pass execute when candidates come from searchIndex', () => {
    const shortlist = [{ modelId: 'opencode/big-pickle', name: 'Big Pickle' }]
    const searchIndex = [
      { modelId: 'opencode/big-pickle', name: 'Big Pickle' },
      { modelId: 'openrouter/meta/llama', name: 'Llama' },
    ]
    const candidates = resolveEligibilityCandidates(
      { availableModels: shortlist },
      { searchIndex },
    )!
    const exec = evaluateModelEligibility({
      modelId: 'openrouter/meta/llama',
      candidates,
      providers: { opencode: 'free', openrouter: 'authenticated' },
      zenFreeAllowlist: ['opencode/big-pickle'],
      purpose: 'execute',
    })
    assert.equal(exec.eligible, true)
    assert.equal(exec.reason, 'pinned_openrouter')

    const shortlistOnly = evaluateModelEligibility({
      modelId: 'openrouter/meta/llama',
      candidates: shortlist,
      providers: { opencode: 'free', openrouter: 'authenticated' },
      zenFreeAllowlist: ['opencode/big-pickle'],
      purpose: 'execute',
    })
    assert.equal(shortlistOnly.eligible, false)
    assert.equal(shortlistOnly.errorCode, 'MODEL_NOT_IN_CANDIDATES')
  })
})

describe('projectPinIntoAvailableModels', () => {
  it('prepends legal pin not already in shortlist', () => {
    const shortlist = [{ modelId: 'opencode/big-pickle', name: 'Big Pickle' }]
    const searchIndex = [
      ...shortlist,
      { modelId: 'openrouter/meta/llama', name: 'Llama', group: 'openrouter' as const },
    ]
    const r = projectPinIntoAvailableModels(shortlist, 'openrouter/meta/llama', searchIndex)
    assert.equal(r?.[0]?.modelId, 'openrouter/meta/llama')
    assert.ok(r?.some((m) => m.modelId === 'opencode/big-pickle'))
    assert.equal(r?.length, 2)
  })

  it('does not duplicate pin already in shortlist', () => {
    const shortlist = [
      { modelId: 'openai/gpt-4o', name: 'GPT-4o' },
      { modelId: 'opencode/big-pickle', name: 'Big Pickle' },
    ]
    const r = projectPinIntoAvailableModels(shortlist, 'openai/gpt-4o')
    assert.equal(r?.filter((m) => m.modelId === 'openai/gpt-4o').length, 1)
    assert.equal(r?.length, 2)
  })

  it('returns shortlist unchanged when pin cleared', () => {
    const shortlist = [{ modelId: 'opencode/big-pickle', name: 'Big Pickle' }]
    const r = projectPinIntoAvailableModels(shortlist, null)
    assert.deepEqual(
      r?.map((m) => m.modelId),
      ['opencode/big-pickle'],
    )
  })
})
