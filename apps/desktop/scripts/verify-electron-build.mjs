import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mainPath = resolve(desktopRoot, 'dist-electron/main.js')
const preloadPath = resolve(desktopRoot, 'dist-electron/preload.mjs')

for (const path of [mainPath, preloadPath]) {
  if (!existsSync(path)) throw new Error(`Missing Electron production entry: ${path}`)
}

const source = readFileSync(mainPath, 'utf8')
const importSpecifiers = [...source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)].map(
  (match) => match[1],
)
if (
  importSpecifiers.some(
    (specifier) => specifier.startsWith('@swarmdesk-agent/') || specifier.endsWith('.ts'),
  )
) {
  throw new Error('Electron main bundle contains a source-only workspace import')
}
if (!source.includes('runtime/http-server.mjs')) {
  throw new Error('Electron main bundle is missing the packaged API runtime path')
}
if (!source.includes('--packaged-smoke')) {
  throw new Error('Electron main bundle is missing packaged smoke mode')
}
if (!source.includes('utilityProcess')) {
  throw new Error('Electron main bundle is missing UtilityProcess support')
}

const relativeSpecifiers = importSpecifiers.filter((specifier) => specifier.startsWith('.'))
for (const specifier of relativeSpecifiers) {
  if (!extname(specifier)) {
    throw new Error(`Electron main bundle contains an extensionless ESM import: ${specifier}`)
  }
  if (!existsSync(resolve(dirname(mainPath), specifier))) {
    throw new Error(`Electron main bundle import is missing: ${specifier}`)
  }
}

console.log('Electron production entries verified')
