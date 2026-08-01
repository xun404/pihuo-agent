#!/usr/bin/env node
/**
 * Validates docs/releases/vX.Y.Z.md against the bilingual release notes contract.
 * Usage: node scripts/verify-release-notes.mjs <notes-path> <release-tag>
 * See: docs/releases/README.md
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const notesPath = process.argv[2]
const releaseTag = process.argv[3]

if (!notesPath || !releaseTag) {
  console.error('Usage: node scripts/verify-release-notes.mjs <notes-path> <release-tag>')
  process.exit(2)
}

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseTag)) {
  throw new Error(`Invalid release tag: ${releaseTag}`)
}

const expectedBase = `${releaseTag}.md`
if (basename(notesPath) !== expectedBase) {
  throw new Error(`Notes file must be named ${expectedBase}, got ${basename(notesPath)}`)
}

const text = readFileSync(notesPath, 'utf8')
const version = releaseTag.slice(1)

const required = [
  `# SwarmDesk ${releaseTag}`,
  '## English',
  '### Summary',
  '### Highlights',
  '### Changes in this release',
  '### Downloads',
  '### Notes',
  '## 中文',
  '### 摘要',
  '### 产品能力',
  '### 本次变更',
  '### 下载',
  '### 说明',
]

for (const heading of required) {
  if (!text.includes(heading)) {
    throw new Error(`Missing required heading or title in ${notesPath}: ${heading}`)
  }
}

// Order: English block before 中文 block
const en = text.indexOf('## English')
const zh = text.indexOf('## 中文')
if (en < 0 || zh < 0 || en > zh) {
  throw new Error('## English must appear before ## 中文')
}

const enSection = text.slice(en, zh)
const zhSection = text.slice(zh)

const enOrder = [
  '### Summary',
  '### Highlights',
  '### Changes in this release',
  '### Downloads',
  '### Notes',
]
const zhOrder = ['### 摘要', '### 产品能力', '### 本次变更', '### 下载', '### 说明']

function assertOrder(section, headings, label) {
  let cursor = -1
  for (const h of headings) {
    const at = section.indexOf(h)
    if (at < 0) throw new Error(`${label} missing ${h}`)
    if (at < cursor) throw new Error(`${label} headings out of order near ${h}`)
    cursor = at
  }
}

assertOrder(enSection, enOrder, 'English')
assertOrder(zhSection, zhOrder, '中文')

if (!text.includes(version) && !text.includes(releaseTag)) {
  throw new Error(`Notes must mention version ${version} or tag ${releaseTag}`)
}

// Each major section should have some body (not empty immediately)
for (const h of [...enOrder, ...zhOrder]) {
  const re = new RegExp(`${escapeRegExp(h)}\\s*\\n+([^#]|$)`)
  if (!re.test(text)) {
    throw new Error(`Section appears empty: ${h}`)
  }
}

console.log(`Release notes OK: ${notesPath} for ${releaseTag}`)

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
