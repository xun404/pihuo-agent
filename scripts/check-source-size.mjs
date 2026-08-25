#!/usr/bin/env node
/**
 * Enforce a physical-line ceiling for production source files.
 *
 * New files must stay within DEFAULT_MAX_LINES. Legacy files above that
 * threshold are listed below with their current line count as a non-growth
 * ceiling; lowering a ceiling is encouraged, raising one needs a design review.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

const DEFAULT_MAX_LINES = 1200

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.css',
  '.html',
])

const EXCLUDED_PATH_PARTS = [
  '/node_modules/',
  '/.worktrees/',
  '/vendor/',
  '/dist/',
  '/build/',
  '/coverage/',
]

const GENERATED_FILES = new Set(['apps/desktop/src/i18n/zh-TW.catalog.ts'])

/**
 * These files predate the policy. Each value is a ceiling, not an exemption:
 * the file may shrink freely but must not grow until it is split.
 */
const LEGACY_LINE_CEILINGS = new Map([
  ['packages/pi-runtime/src/http-server.ts', 3837],
  ['apps/desktop/src/components/SettingsPanel.tsx', 3799],
  ['packages/adapters/src/acp-session-manager.ts', 2336],
  ['apps/desktop/src/styles/03-composer.css', 2297],
  ['apps/desktop/src/components/ChatPanel.tsx', 2228],
  ['packages/core/src/store.ts', 2056],
  ['packages/pi-runtime/src/scheduler.ts', 2031],
  ['apps/desktop/src/styles/05-worker-inspector.css', 1603],
  ['packages/pi-runtime/src/routes/api.ts', 1526],
  ['packages/pi-runtime/src/acp-registry-api.ts', 1467],
  ['apps/desktop/src/lib/api.ts', 1276],
  ['packages/pi-runtime/src/tools/session-tools.ts', 1240],
  ['packages/pi-runtime/src/acp-auth-terminal.ts', 1202],
])

function trackedAndUntrackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
}

function isProductionSource(file) {
  if (!SOURCE_EXTENSIONS.has(extname(file))) return false
  if (GENERATED_FILES.has(file) || file.includes('/bundled/')) return false
  if (file.startsWith('docs/')) return false
  if (EXCLUDED_PATH_PARTS.some((part) => file.includes(part))) return false
  return !/\.(?:test|spec)\.[^.]+$/u.test(file)
}

function countPhysicalLines(file) {
  const source = readFileSync(file, 'utf8')
  if (!source) return 0
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0)
}

const violations = []
let checked = 0

for (const file of trackedAndUntrackedFiles()) {
  if (!isProductionSource(file)) continue
  checked += 1
  const lines = countPhysicalLines(file)
  const ceiling = LEGACY_LINE_CEILINGS.get(file) ?? DEFAULT_MAX_LINES
  if (lines > ceiling) {
    violations.push({ file, lines, ceiling, legacy: LEGACY_LINE_CEILINGS.has(file) })
  }
}

if (violations.length > 0) {
  console.error('Source-size policy violations:')
  for (const violation of violations) {
    const kind = violation.legacy ? 'legacy non-growth ceiling' : 'default ceiling'
    console.error(
      `- ${violation.file}: ${violation.lines} lines exceeds ${kind} of ${violation.ceiling}; split the module or document a reviewed exception.`,
    )
  }
  process.exitCode = 1
} else {
  console.log(
    `Source-size policy passed: ${checked} production files checked; ${LEGACY_LINE_CEILINGS.size} capped legacy files.`,
  )
}
