import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readAuthProviderIds,
  readDisabledProviders,
  resolveOpenCodeEvidencePaths,
} from './opencode-models.js'
import { prepareOpenCodeAcpEnv } from './opencode-acp-env.js'

describe('OpenCode XDG evidence fail-closed', () => {
  let dir: string
  let home: string
  let xdgData: string
  let xdgConfig: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oc-xdg-'))
    home = join(dir, 'home')
    xdgData = join(dir, 'xdg-data')
    xdgConfig = join(dir, 'xdg-config')
    mkdirSync(join(home, '.local/share/opencode'), { recursive: true })
    mkdirSync(join(home, '.config/opencode'), { recursive: true })
    mkdirSync(join(xdgData, 'opencode'), { recursive: true })
    mkdirSync(join(xdgConfig, 'opencode'), { recursive: true })
    writeFileSync(
      join(home, '.local/share/opencode/auth.json'),
      JSON.stringify({ 'home-provider': {} }),
    )
    writeFileSync(
      join(home, '.config/opencode/opencode.json'),
      JSON.stringify({ disabled_providers: ['home-disabled'] }),
    )
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('without explicit XDG, uses HOME evidence', () => {
    const auth = readAuthProviderIds(home)
    assert.ok(auth.has('home-provider'))
    const disabled = readDisabledProviders(home)
    assert.ok(disabled.has('home-disabled'))
  })

  it('explicit XDG wins and does not merge HOME when XDG has data', () => {
    writeFileSync(join(xdgData, 'opencode/auth.json'), JSON.stringify({ 'xdg-provider': {} }))
    const auth = readAuthProviderIds(home, { xdgDataHome: xdgData })
    assert.ok(auth.has('xdg-provider'))
    assert.equal(auth.has('home-provider'), false)
  })

  it('explicit XDG missing file: fail-closed (no HOME fallback)', () => {
    // xdgData dir exists but no auth.json
    const auth = readAuthProviderIds(home, { xdgDataHome: xdgData })
    assert.equal(auth.has('home-provider'), false)
    assert.ok(auth.has('opencode')) // zen free always
  })

  it('explicit XDG corrupt file: fail-closed (no HOME fallback)', () => {
    writeFileSync(join(xdgData, 'opencode/auth.json'), '{not-json')
    const auth = readAuthProviderIds(home, { xdgDataHome: xdgData })
    assert.equal(auth.has('home-provider'), false)
  })

  it('explicit empty XDG_DATA_HOME: no auth paths, no HOME', () => {
    const paths = resolveOpenCodeEvidencePaths({
      realHome: home,
      XDG_DATA_HOME: '',
      explicitXdgData: true,
    })
    assert.equal(paths.authPaths.length, 0)
  })

  it('disabled providers: explicit XDG no HOME fallback on missing', () => {
    const disabled = readDisabledProviders(home, { xdgConfigHome: xdgConfig })
    assert.equal(disabled.has('home-disabled'), false)
  })

  it('projects the same explicit XDG config evidence into ACP execution', () => {
    writeFileSync(
      join(xdgConfig, 'opencode/opencode.json'),
      JSON.stringify({
        disabled_providers: ['xdg-disabled'],
        provider: {
          custom: {
            options: { baseURL: 'https://example.test/v1' },
            apiKey: 'must-not-be-projected',
          },
        },
      }),
    )
    const prep = prepareOpenCodeAcpEnv({
      baseEnv: {
        HOME: home,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_DATA_HOME: '',
      },
      model: 'custom/model-a',
      candidates: [{ modelId: 'custom/model-a', name: 'Model A' }],
      providers: { custom: 'authenticated' },
    })
    try {
      const projected = JSON.parse(readFileSync(prep.env.OPENCODE_CONFIG!, 'utf8')) as {
        disabled_providers?: string[]
        provider?: Record<string, Record<string, unknown>>
      }
      assert.deepEqual(projected.disabled_providers, ['xdg-disabled'])
      assert.equal(projected.disabled_providers?.includes('home-disabled'), false)
      assert.deepEqual(projected.provider?.custom?.options, {
        baseURL: 'https://example.test/v1',
      })
      assert.equal('apiKey' in (projected.provider?.custom ?? {}), false)
      assert.equal(prep.env.XDG_DATA_HOME, '', 'explicit empty XDG data must remain fail-closed')
    } finally {
      rmSync(prep.isolatedHome, { recursive: true, force: true })
    }
  })

  it('explicit empty XDG_CONFIG_HOME does not project HOME config', () => {
    const prep = prepareOpenCodeAcpEnv({
      baseEnv: { HOME: home, XDG_CONFIG_HOME: '' },
      model: null,
    })
    try {
      const projected = JSON.parse(readFileSync(prep.env.OPENCODE_CONFIG!, 'utf8')) as {
        disabled_providers?: string[]
      }
      assert.equal(projected.disabled_providers, undefined)
    } finally {
      rmSync(prep.isolatedHome, { recursive: true, force: true })
    }
  })
})
