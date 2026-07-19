import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSafeExternalUrl,
  isTrustedRendererUrl,
  resolveDesktopApiPort,
  resolveTrustedDevServerUrl,
} from './renderer-security.js'

describe('desktop renderer security boundary', () => {
  it('accepts only valid TCP ports and falls back on injected URL-like values', () => {
    assert.equal(resolveDesktopApiPort('4119'), 4119)
    assert.equal(resolveDesktopApiPort('65535'), 65535)
    assert.equal(resolveDesktopApiPort('0'), 4111)
    assert.equal(resolveDesktopApiPort('65536'), 4111)
    assert.equal(resolveDesktopApiPort('https://attacker.example'), 4111)
  })

  it('allows only the configured Vite origin in development', () => {
    const input = { devServerUrl: 'http://localhost:5173/', distDir: '/app/dist' }
    assert.equal(isTrustedRendererUrl({ ...input, url: 'http://localhost:5173/project?a=1' }), true)
    assert.equal(isTrustedRendererUrl({ ...input, url: 'http://127.0.0.1:5173/' }), false)
    assert.equal(isTrustedRendererUrl({ ...input, url: 'https://attacker.example/' }), false)
  })

  it('accepts a Vite URL only on a loopback origin', () => {
    assert.equal(resolveTrustedDevServerUrl('http://localhost:5173'), 'http://localhost:5173/')
    assert.equal(
      resolveTrustedDevServerUrl('https://127.0.0.1:5173/app'),
      'https://127.0.0.1:5173/app',
    )
    assert.equal(resolveTrustedDevServerUrl('http://[::1]:5173'), 'http://[::1]:5173/')
    assert.equal(resolveTrustedDevServerUrl('https://attacker.example/app'), undefined)
    assert.equal(resolveTrustedDevServerUrl('http://user:pass@localhost:5173'), undefined)
  })

  it('allows packaged files only from the renderer dist directory', () => {
    const input = { distDir: '/app/dist' }
    assert.equal(isTrustedRendererUrl({ ...input, url: 'file:///app/dist/index.html' }), true)
    assert.equal(isTrustedRendererUrl({ ...input, url: 'file:///app/dist/assets/app.js' }), true)
    assert.equal(isTrustedRendererUrl({ ...input, url: 'file:///app/secret.html' }), false)
    assert.equal(isTrustedRendererUrl({ ...input, url: 'https://attacker.example/' }), false)
  })

  it('opens only ordinary web URLs externally', () => {
    assert.equal(isSafeExternalUrl('https://docs.example/path'), true)
    assert.equal(isSafeExternalUrl('http://localhost:3000/path'), true)
    assert.equal(isSafeExternalUrl('file:///etc/passwd'), false)
    assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
    assert.equal(isSafeExternalUrl('custom-protocol://payload'), false)
  })
})
