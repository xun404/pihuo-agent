import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const mode = process.env.ACP_FAKE_NPM_MODE ?? 'success'
const prefixIndex = process.argv.indexOf('--prefix')
const installDir = prefixIndex >= 0 ? process.argv[prefixIndex + 1] : undefined
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

if (!installDir) {
  process.stderr.write('missing --prefix\n')
  process.exit(2)
}

trace(`start:${mode}`)

if (mode === 'hang') {
  setInterval(() => {}, 1_000)
  setTimeout(() => process.exit(0), 1_000)
} else if (mode === 'exit-error') {
  process.stderr.write(`install failed at ${installDir} token=fixture-secret\n`)
  process.exit(17)
} else {
  const packageDir = join(installDir, 'node_modules', '@example', 'agent')
  mkdirSync(join(packageDir, 'dist'), { recursive: true })
  const bin =
    mode === 'missing-bin'
      ? undefined
      : mode === 'multiple-bin'
        ? { one: 'dist/cli.js', two: 'dist/other.js' }
        : mode === 'escaping-bin'
          ? '../../../outside.js'
          : 'dist/cli.js'
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: '@example/agent', version: '1.2.3', ...(bin ? { bin } : {}) }),
  )
  writeFileSync(join(packageDir, 'dist', 'cli.js'), '#!/usr/bin/env node\n', { mode: 0o755 })
  writeFileSync(join(packageDir, 'dist', 'other.js'), '#!/usr/bin/env node\n', { mode: 0o755 })
  trace('complete')
}
