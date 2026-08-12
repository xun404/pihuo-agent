import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  catalogs,
  detectLocale,
  isLocale,
  localeToBcp47,
  type MessageKey,
} from './locales.js'

describe('locale catalogs', () => {
  it('includes traditional Chinese zh-TW with full key coverage', () => {
    assert.ok(isLocale('zh-TW'))
    assert.equal(localeToBcp47('zh-TW'), 'zh-TW')
    const zhKeys = Object.keys(catalogs.zh) as MessageKey[]
    for (const key of zhKeys) {
      assert.equal(typeof catalogs['zh-TW'][key], 'string', key)
      assert.ok(catalogs['zh-TW'][key].length > 0, key)
    }
  })

  it('keeps the hand-authored catalogs aligned', () => {
    const zhKeys = Object.keys(catalogs.zh).sort()
    const enKeys = Object.keys(catalogs.en).sort()
    assert.deepEqual(enKeys, zhKeys)
  })

  it('does not use npmmirror as the npm registry input placeholder', () => {
    for (const locale of ['zh', 'zh-TW', 'en'] as const) {
      const ph = catalogs[locale]['settings.runtime.npmRegistryPh']
      assert.ok(!/npmmirror/i.test(ph), `${locale}: ${ph}`)
    }
  })

  it('detects zh-TW from navigator.language', () => {
    const original = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'zh-TW' },
    })
    try {
      assert.equal(detectLocale(), 'zh-TW')
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: original,
      })
    }
  })
})
