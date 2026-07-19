import { createRequire, isBuiltin } from 'node:module'
import { chmod, cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const OPTIONAL_RUNTIME_IMPORTS = new Set(['bufferutil', 'utf-8-validate'])

export function resolveLibsqlNativePackage(platform, arch, libcFamily = 'glibc') {
  if (platform === 'darwin' && arch === 'arm64') {
    return '@libsql/darwin-arm64'
  }
  if (platform === 'win32' && arch === 'x64') {
    return '@libsql/win32-x64-msvc'
  }
  if (platform === 'linux' && arch === 'x64' && libcFamily === 'glibc') {
    return '@libsql/linux-x64-gnu'
  }
  throw new Error(`Unsupported desktop runtime target: ${platform}-${arch}-${libcFamily}`)
}

export function requiredRuntimePackageNames(target) {
  return [
    'libsql',
    '@neon-rs/load',
    'detect-libc',
    resolveLibsqlNativePackage(target.platform, target.arch, target.libcFamily ?? 'glibc'),
    'node-pty',
  ]
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

export function isLoadedLibsqlModule(value) {
  return typeof value === 'function'
}

export function isLoadedNodePtyModule(value) {
  return Boolean(value && typeof value === 'object' && typeof value.spawn === 'function')
}

/** Native PTY load + spawn/write/resize/exit smoke used by runtime verification. */
export async function verifyNodePtyRoundTrip(input) {
  const ptyModule = input.ptyModule
  if (!isLoadedNodePtyModule(ptyModule)) {
    throw new Error('Staged node-pty package did not expose spawn')
  }
  const marker = 'SWARMDESK_AGENT_PTY_100x30'
  const script = [
    "process.stdin.setEncoding('utf8')",
    "process.stdout.write('SWARMDESK_AGENT_PTY_READY\\n')",
    "process.stdin.once('data', () => {",
    '  let polls = 0',
    '  const timer = setInterval(() => {',
    '    if (process.stdout.columns === 100 && process.stdout.rows === 30) {',
    '      clearInterval(timer)',
    `      process.stdout.write('${marker}\\n')`,
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
      if (error) reject(error)
      else resolveSmoke()
    }
    const timeout = setTimeout(() => {
      try {
        if ((input.platform ?? process.platform) === 'win32') terminal?.kill()
        else terminal?.kill('SIGKILL')
      } catch {
        /* */
      }
      settle(new Error('Staged node-pty round-trip timed out'))
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
        if (!wrote && output.includes('SWARMDESK_AGENT_PTY_READY')) {
          wrote = true
          terminal.resize(100, 30)
          terminal.write('continue\r')
        }
        if (observedExitCode === 0 && output.includes(marker)) settle()
      })
      exitDisposable = terminal.onExit(({ exitCode }) => {
        observedExitCode = exitCode
        if (exitCode !== 0) {
          settle(new Error(`Staged node-pty child exited ${exitCode}`))
          return
        }
        // node-pty may deliver the final data event immediately after onExit.
        if (output.includes(marker)) settle()
      })
    } catch (error) {
      settle(error)
    }
  })
}

async function findPackageRoot(packageName) {
  let current = dirname(require.resolve(packageName))
  const filesystemRoot = parse(current).root
  while (current !== filesystemRoot) {
    const packagePath = join(current, 'package.json')
    try {
      const parsed = JSON.parse(await readFile(packagePath, 'utf8'))
      if (parsed?.name === packageName) return current
    } catch {
      // Continue walking toward the filesystem root.
    }
    current = dirname(current)
  }
  throw new Error(`Cannot locate package root for ${packageName}`)
}

export async function stageRuntimePackages(input) {
  const packageNames = requiredRuntimePackageNames(input.target)
  const nodeModulesDir = resolve(input.outputDir, 'node_modules')
  await mkdir(nodeModulesDir, { recursive: true })

  for (const packageName of packageNames) {
    const source = await findPackageRoot(packageName)
    const destination = resolve(nodeModulesDir, ...packageName.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      force: true,
    })
    if (packageName === 'node-pty' && input.target.platform !== 'win32') {
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
  }

  return packageNames
}
