import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const brandLogoSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'BrandLogo.tsx'),
  'utf8',
)

describe('BrandLogo packaged asset URLs', () => {
  it('does not hardcode absolute root paths (breaks under Electron file://)', () => {
    assert.equal(brandLogoSource.includes("'/icon.png'"), false)
    assert.equal(brandLogoSource.includes('"/icon.png"'), false)
    assert.equal(brandLogoSource.includes("'/icon-glyph.png'"), false)
    assert.equal(brandLogoSource.includes('"/icon-glyph.png"'), false)
  })

  it('builds URLs from Vite BASE_URL so relative base works in packaged apps', () => {
    assert.match(brandLogoSource, /import\.meta\.env\.BASE_URL/)
    assert.match(brandLogoSource, /icon-glyph\.png/)
    assert.match(brandLogoSource, /icon\.png/)
  })
})
