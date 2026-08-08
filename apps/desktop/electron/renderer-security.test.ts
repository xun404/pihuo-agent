import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  isSafeExternalUrl,
  isTrustedRendererUrl,
  resolveDesktopApiPort,
  resolveTrustedDevServerUrl,
} from './renderer-security.js'

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('./preload.ts', import.meta.url), 'utf8')

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

  it('notifications:show rejects untrusted senders: handler must call requireTrustedRenderer first', () => {
    // main.ts imports electron at module scope and keeps requireTrustedRenderer
    // module-private, so the handler cannot be exercised in-process. Verify the
    // security contract at the source level instead (same pattern as
    // theme-ipc-contract.test.ts): the handler's first statement is the trust
    // gate whose sole failure path is the "untrusted renderer" rejection.
    assert.match(main, /ipcMain\.handle\('notifications:show'/u)
    assert.match(main, /notifications:show[\s\S]{0,240}requireTrustedRenderer\(event\)/u)
    assert.match(main, /IPC request rejected from an untrusted renderer/u)
    assert.match(main, /throw new Error\('Notification payload is invalid'\)/u)
    assert.match(preload, /notify:\s*\{/u)
    assert.match(preload, /ipcRenderer\.invoke\('notifications:show', payload\)/u)
  })

  it('preload onOpenSession mirrors onOpenSettings with an unsubscribe pattern', () => {
    assert.match(preload, /onOpenSession:/u)
    assert.match(preload, /ipcRenderer\.on\('app:open-session', listener\)/u)
    assert.match(preload, /ipcRenderer\.removeListener\('app:open-session', listener\)/u)
  })
})
