/**
 * Generate apps/desktop/src/i18n/zh-TW.catalog.ts from the simplified `zh` dict
 * in locales.ts using OpenCC (cn → tw).
 *
 * Usage: node scripts/generate-zh-tw-locale.mjs
 * Requires: opencc-js (devDependency or temporarily installed).
 */
import * as OpenCC from 'opencc-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const localesPath = join(root, 'apps/desktop/src/i18n/locales.ts')
const outPath = join(root, 'apps/desktop/src/i18n/zh-TW.catalog.ts')

const src = readFileSync(localesPath, 'utf8')
const startMarker = 'const zh: Dict = {'
const endMarker = '\nconst en: Dict = {'
const start = src.indexOf(startMarker)
const end = src.indexOf(endMarker)
if (start < 0 || end < 0) throw new Error('Could not locate zh/en dict markers in locales.ts')
const body = src.slice(start + startMarker.length, end)

/** Parse TS object body of string entries (supports string concatenation). */
function parseDict(bodyText) {
  const out = {}
  let i = 0
  const n = bodyText.length
  const ws = () => {
    while (i < n && /\s/.test(bodyText[i])) i++
  }
  const readString = () => {
    const q = bodyText[i]
    if (q !== "'" && q !== '"' && q !== '`') {
      throw new Error(`expected string at ${i}: ${JSON.stringify(bodyText.slice(i, i + 40))}`)
    }
    i++
    let s = ''
    while (i < n) {
      const c = bodyText[i]
      if (c === '\\') {
        s += bodyText[i + 1]
        i += 2
        continue
      }
      if (c === q) {
        i++
        return s
      }
      s += c
      i++
    }
    throw new Error('unterminated string')
  }
  while (i < n) {
    ws()
    if (i >= n) break
    if (bodyText[i] === '}') break
    if (bodyText.startsWith('//', i)) {
      while (i < n && bodyText[i] !== '\n') i++
      continue
    }
    if (bodyText[i] !== "'") {
      throw new Error(`expected key at ${i}: ${JSON.stringify(bodyText.slice(i, i + 40))}`)
    }
    const key = readString()
    ws()
    if (bodyText[i] !== ':') throw new Error(`expected : after ${key}`)
    i++
    let value = ''
    while (true) {
      ws()
      value += readString()
      ws()
      if (bodyText[i] === '+') {
        i++
        continue
      }
      break
    }
    if (bodyText[i] === ',') i++
    out[key] = value
  }
  return out
}

const obj = parseDict(body)
const converter = OpenCC.Converter({ from: 'cn', to: 'tw' })
const keys = Object.keys(obj)

const lines = [
  '/**',
  ' * Auto-generated Traditional Chinese (zh-TW) UI catalog.',
  ' * Source: simplified `zh` via OpenCC cn→tw. Regenerate with:',
  ' *   node scripts/generate-zh-tw-locale.mjs',
  ' */',
  '',
  'export const zhTW: Record<string, string> = {',
]
for (const key of keys) {
  const converted = converter(String(obj[key]))
  const escaped = converted
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
  lines.push(`  '${key}': '${escaped}',`)
}
lines.push('}')
lines.push('')
writeFileSync(outPath, lines.join('\n'))
console.log(`wrote ${outPath} (${keys.length} keys)`)
