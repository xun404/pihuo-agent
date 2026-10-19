import { isBuiltin } from 'node:module'
import { chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { stagePackageClosure } from './runtime-package-closure.mjs'

const OPTIONAL_RUNTIME_IMPORTS = new Set(['bufferutil', 'utf-8-validate'])

export function assertSupportedRuntimeTarget(platform, arch, libcFamily = 'glibc') {
  if (platform === 'darwin' && arch === 'arm64') {
    return
  }
  if (platform === 'win32' && arch === 'x64') {
    return
  }
  if (platform === 'linux' && arch === 'x64' && libcFamily === 'glibc') {
    return
  }
  throw new Error(`Unsupported desktop runtime target: ${platform}-${arch}-${libcFamily}`)
}

export function requiredRuntimePackageNames(target) {
  assertSupportedRuntimeTarget(target.platform, target.arch, target.libcFamily)
  return ['node-pty', '@earendil-works/pi-coding-agent']
}

export function runtimeExternalPackageNames(target) {
  return requiredRuntimePackageNames(target)
}

function packageNameFromImportSpecifier(specifier) {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('node:') ||
    specifier.startsWith('file:') ||
    isBuiltin(specifier)
  ) {
    return undefined
  }
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

export function unstagedRuntimeImportSpecifiers(importSpecifiers, stagedPackageNames) {
  const staged = new Set(stagedPackageNames)
  return importSpecifiers.filter((specifier) => {
    const packageName = packageNameFromImportSpecifier(specifier)
    return (
      packageName !== undefined &&
      !staged.has(packageName) &&
      !OPTIONAL_RUNTIME_IMPORTS.has(packageName)
    )
  })
}

export function currentLibcFamily() {
  if (process.platform !== 'linux') return undefined
  const report = process.report?.getReport()
  if (
    report &&
    typeof report === 'object' &&
    'header' in report &&
    report.header &&
    typeof report.header === 'object' &&
    'glibcVersionRuntime' in report.header
  ) {
    return 'glibc'
  }
  return 'musl'
}

export function isLoadedNodePtyModule(value) {
  return Boolean(value && typeof value === 'object' && typeof value.spawn === 'function')
}

/**
 * Native PTY load + spawn/write/resize/exit smoke used by runtime verification.
 *
 * On POSIX, ConPTY-style resize is reflected in process.stdout.columns/rows.
 * On Windows ConPTY, Node often never updates those dimensions after a parent
 * resize, so we only require spawn + write + echo + clean exit (still call
 * resize() to exercise the API).
 */
export async function verifyNodePtyRoundTrip(input) {
  const ptyModule = input.ptyModule
  if (!isLoadedNodePtyModule(ptyModule)) {
    throw new Error('Staged node-pty package did not expose spawn')
  }
  const platform = input.platform ?? process.platform
  const isWin = platform === 'win32'
  const readyMarker = 'PIHUO_AGENT_PTY_READY'
  const successMarker = isWin ? 'PIHUO_AGENT_PTY_OK' : 'PIHUO_AGENT_PTY_100x30'
  const script = isWin
    ? [
        "process.stdin.setEncoding('utf8')",
        `process.stdout.write('${readyMarker}\\n')`,
        "process.stdin.once('data', () => {",
        `  process.stdout.write('${successMarker}\\n')`,
        '  process.exit(0)',
        '})',
      ].join(';')
    : [
        "process.stdin.setEncoding('utf8')",
        `process.stdout.write('${readyMarker}\\n')`,
        "process.stdin.once('data', () => {",
        '  let polls = 0',
        '  const timer = setInterval(() => {',
        '    if (process.stdout.columns === 100 && process.stdout.rows === 30) {',
        '      clearInterval(timer)',
        `      process.stdout.write('${successMarker}\\n')`,
        '      process.exit(0)',
        '    }',
        '    if (++polls >= 100) { clearInterval(timer); process.exit(2) }',
        '  }, 10)',
        '})',
      ].join(';')
  const env = Object.fromEntries(
    Object.entries(input.env ?? process.env).filter((entry) => typeof entry[1] === 'string'),
  )

  await new Promise((resolveSmoke, reject) => {
    let output = ''
    let wrote = false
    let settled = false
    let observedExitCode
    let terminal
    const settle = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        dataDisposable?.dispose()
      } catch {
        /* */
      }
      try {
        exitDisposable?.dispose()
      } catch {
        /* */
      }
      // Always reap the PTY host. On Windows ConPTY, open pipes keep the Node
      // event loop alive after a successful child exit — CI then hangs until
      // the job timeout (seen as "verified" then ~1h cancel).
      try {
        if (isWin) terminal?.kill()
        else terminal?.kill('SIGKILL')
      } catch {
        /* already exited */
      }
      if (error) reject(error)
      else resolveSmoke()
    }
    const timeout = setTimeout(() => {
      settle(
        new Error(
          `Staged node-pty round-trip timed out (output=${JSON.stringify(output.slice(-400))})`,
        ),
      )
    }, input.timeoutMs ?? 10_000)
    let dataDisposable
    let exitDisposable

    try {
      terminal = ptyModule.spawn(input.nodeExecutable ?? process.execPath, ['-e', script], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: input.cwd,
        env,
      })
      dataDisposable = terminal.onData((chunk) => {
        output += chunk
        if (!wrote && output.includes(readyMarker)) {
          wrote = true
          // Exercise resize even on Windows (API smoke); do not require columns/rows.
          terminal.resize(100, 30)
          terminal.write('continue\r')
        }
        if (observedExitCode === 0 && output.includes(successMarker)) settle()
      })
      exitDisposable = terminal.onExit(({ exitCode }) => {
        observedExitCode = exitCode
        if (exitCode !== 0) {
          settle(
            new Error(
              `Staged node-pty child exited ${exitCode} (output=${JSON.stringify(output.slice(-400))})`,
            ),
          )
          return
        }
        // node-pty may deliver the final data event immediately after onExit.
        if (output.includes(successMarker)) settle()
      })
    } catch (error) {
      settle(error)
    }
  })
}

export async function stageRuntimePackages(input) {
  const packageNames = requiredRuntimePackageNames(input.target)
  const nodeModulesDir = resolve(input.outputDir, 'node_modules')
  const staged = await stagePackageClosure({
    names: packageNames,
    sourceNodeModules: resolve(import.meta.dirname, '../../../node_modules'),
    outputNodeModules: nodeModulesDir,
  })
  const destination = resolve(nodeModulesDir, 'node-pty')
  if (input.target.platform !== 'win32') {
    // Some registry mirrors strip the prebuilt helper's executable bit. The
    // helper is part of node-pty's native runtime closure and posix_spawnp
    // fails unless the staged copy is executable.
    for (const helper of [
      resolve(
        destination,
        'prebuilds',
        `${input.target.platform}-${input.target.arch}`,
        'spawn-helper',
      ),
      resolve(destination, 'build', 'Release', 'spawn-helper'),
    ]) {
      try {
        await chmod(helper, 0o755)
      } catch {
        /* target uses the other layout */
      }
    }
  }

  return staged
}
