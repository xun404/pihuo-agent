import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('Owner terminal-auth route contract', () => {
  it('binds POST/status/upgrade/shutdown to current Desktop capability without client launch input', () => {
    const source = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')
    assert.match(source, /match\(path, '\/api\/workers\/:id\/auth-terminal\/:attemptId'\)/u)
    assert.match(source, /terminalAuthAttemptPublicStatus\(/u)
    assert.match(source, /desktopToken: desktopApiToken/u)
    assert.match(
      source,
      /handleTerminalAuthUpgrade\(req, socket, head, \{[\s\S]*?desktopToken: desktopApiToken/u,
    )
    assert.match(source, /await drainTerminalAuthAttemptsForShutdown\(\{/u)
    assert.match(
      source,
      /stopAdmission:\s*\(\)\s*=>\s*[\s\S]*?new Promise<void>[\s\S]*?server\.close/u,
    )

    const start = source.indexOf("match(path, '/api/workers/:id/auth-terminal')")
    const end = source.indexOf('const delWorkerMatch', start)
    const route = source.slice(start, end)
    assert.match(route, /Object\.keys\(body\)/u)
    assert.doesNotMatch(route, /body\.command|body\.args|body\.env/u)
  })
})
