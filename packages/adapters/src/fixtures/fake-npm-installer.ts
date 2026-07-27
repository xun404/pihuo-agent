import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'

const mode = process.env.ACP_FAKE_NPM_MODE ?? 'success'
const prefixIndex = process.argv.indexOf('--prefix')
const installDir = prefixIndex >= 0 ? process.argv[prefixIndex + 1] : undefined
const packageSep = process.argv.lastIndexOf('--')
const packageSpec = packageSep >= 0 ? process.argv[packageSep + 1] : undefined
const traceFile = process.env.ACP_FAKE_NPM_TRACE_FILE

function trace(event: string): void {
  if (!traceFile) return
  mkdirSync(dirname(traceFile), { recursive: true })
  writeFileSync(traceFile, `${event}\n`, { flag: 'a' })
}

process.on('SIGTERM', () => {
  trace('signal:SIGTERM')
  process.exit(0)
})

if (!installDir || !packageSpec) {
  process.stderr.write('missing --prefix or package spec\n')
  process.exit(2)
}

trace(`start:${mode}`)
trace(`owner-secret:${process.env.SWARMDESK_AGENT_INTERNAL_TOKEN ? 'present' : 'absent'}`)

if (mode === 'tree-hang') {
  const descendant = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { stdio: 'ignore' },
  )
  trace(`descendant:${descendant.pid}`)
  setInterval(() => {}, 1_000)
} else if (mode === 'hang') {
  setInterval(() => {}, 1_000)
  setTimeout(() => process.exit(0), 1_000)
} else if (mode === 'exit-error') {
  process.stderr.write(`install failed at ${installDir} token=fixture-secret\n`)
  process.exit(17)
} else {
  const versionAt = packageSpec.lastIndexOf('@')
  const packageName = packageSpec.slice(0, versionAt)
  const version = mode === 'mismatched-version' ? '9.9.9' : packageSpec.slice(versionAt + 1)
  const packageDir = join(installDir, 'node_modules', ...packageName.split('/'))
  mkdirSync(join(packageDir, 'dist'), { recursive: true })
  const bin =
    mode === 'missing-bin'
      ? undefined
      : mode === 'multiple-bin'
        ? { one: 'dist/cli.js', two: 'dist/other.js' }
        : mode === 'escaping-bin'
          ? '../../../outside.js'
          : mode === 'native-bin'
            ? 'dist/agent'
            : 'dist/cli.js'
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, version, ...(bin ? { bin } : {}) }),
  )
  writeFileSync(join(packageDir, 'dist', 'cli.js'), '#!/usr/bin/env node\n', { mode: 0o755 })
  writeFileSync(join(packageDir, 'dist', 'other.js'), '#!/usr/bin/env node\n', { mode: 0o755 })
  writeFileSync(join(packageDir, 'dist', 'agent'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), {
    mode: 0o755,
  })
  trace('complete')
}
