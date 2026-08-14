import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

describe('danger-zone owner route', () => {
  it('exposes stats and every destructive action through the authenticated API server', () => {
    const source = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')
    assert.match(source, /path === '\/api\/settings\/danger-zone'/u)
    for (const action of [
      'reset-settings',
      'clear-workers-and-crews',
      'clear-sessions',
      'clear-cache',
      'reset-all',
    ]) {
      assert.match(source, new RegExp(`'${action}'`, 'u'))
    }
    assert.match(source, /performDangerZoneAction\(action/u)
    assert.match(source, /deleteMemoryThreads:/u)
    assert.match(source, /disposeAndDeleteLeaderSession\(threadId\)/u)
    assert.match(source, /DangerZoneBusyError/u)

    const resetStart = source.indexOf("if (action === 'reset-settings')")
    const resetEnd = source.indexOf(
      "if (\n          action !== 'clear-workers-and-crews'",
      resetStart,
    )
    assert.ok(resetStart >= 0 && resetEnd > resetStart)
    const resetBranch = source.slice(resetStart, resetEnd)
    assert.match(resetBranch, /store\.countOpenJobs\(\)/u)
    assert.match(resetBranch, /send\(res, 409,/u)
    assert.match(resetBranch, /code: error\.code/u)
    assert.ok(resetBranch.indexOf('store.countOpenJobs()') < resetBranch.indexOf('store.setLocale'))
  })
})
