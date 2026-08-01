import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./verify-release-notes.mjs', import.meta.url))
const validNotes = fileURLToPath(new URL('../docs/releases/v0.1.0.md', import.meta.url))

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

describe('verify-release-notes', () => {
  it('accepts the checked-in v0.1.0 bilingual notes', () => {
    const r = run([validNotes, 'v0.1.0'])
    assert.equal(r.status, 0, r.stderr || r.stdout)
    assert.match(r.stdout, /Release notes OK/)
  })

  it('rejects wrong filename for the tag', () => {
    const r = run([validNotes, 'v0.2.0'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr || r.stdout, /must be named v0\.2\.0\.md/)
  })

  it('rejects notes missing the Chinese section', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rel-notes-'))
    const path = join(dir, 'v9.9.9.md')
    writeFileSync(
      path,
      `# SwarmDesk v9.9.9

## English

### Summary

x

### Highlights

- a

### Changes in this release

- b

### Downloads

| Platform | Artifact |
| -------- | -------- |
| macOS | x |

### Notes

- n
`,
    )
    const r = run([path, 'v9.9.9'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr || r.stdout, /中文/)
  })
})
