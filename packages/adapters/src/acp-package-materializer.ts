import { mkdirSync, readFileSync, realpathSync, lstatSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, relative, resolve, sep } from 'node:path'

export type MaterializeNpmPackageInput = {
  packageSpec: string
  stagingDir: string
  npmCommand: string
  npmArgsPrefix?: string[]
  env: Readonly<Record<string, string>>
  signal?: AbortSignal
  timeoutMs?: number
}

export type MaterializedNpmPackage = {
  packageName: string
  executableRelativePath: string
}

export class PackageMaterializeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PackageMaterializeError'
  }
}

function exactPackageName(packageSpec: string): string {
  const spec = packageSpec.trim()
  const versionAt = spec.lastIndexOf('@')
  const scopedSlash = spec.startsWith('@') ? spec.indexOf('/') : -1
  const name = versionAt > Math.max(0, scopedSlash) ? spec.slice(0, versionAt) : ''
  const version = versionAt >= 0 ? spec.slice(versionAt + 1) : ''
  if (!name || !version || name.includes('\\') || name.includes('..')) {
    throw new PackageMaterializeError(
      'ACP_INSTALL_ENTRY_INVALID',
      'Registry package must use an exact package name and version',
    )
  }
  return name
}

function uniqueBinPath(manifest: { bin?: unknown }, packageName: string): string {
  if (typeof manifest.bin === 'string' && manifest.bin.trim()) return manifest.bin.trim()
  if (manifest.bin && typeof manifest.bin === 'object' && !Array.isArray(manifest.bin)) {
    const entries = Object.values(manifest.bin).filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    )
    if (entries.length === 1) return entries[0]!.trim()
  }
  throw new PackageMaterializeError(
    'ACP_INSTALL_ENTRY_INVALID',
    `Registry package ${packageName} must expose exactly one executable`,
  )
}

async function runInstaller(input: MaterializeNpmPackageInput): Promise<void> {
  if (input.signal?.aborted) {
    throw new PackageMaterializeError('ACP_INSTALL_ABORTED', 'Registry package install cancelled')
  }
  const args = [
    ...(input.npmArgsPrefix ?? []),
    'install',
    '--prefix',
    input.stagingDir,
    '--no-save',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    '--no-bin-links',
    '--ignore-scripts',
    '--',
    input.packageSpec,
  ]
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(input.npmCommand, args, {
      cwd: input.stagingDir,
      env: { ...input.env },
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    let settled = false
    let lifecycleFailure: PackageMaterializeError | undefined
    let stderrTail = ''
    const timeoutMs = Math.min(Math.max(1, input.timeoutMs ?? 10 * 60_000), 30 * 60_000)
    const deadline = setTimeout(() => {
      lifecycleFailure = new PackageMaterializeError(
        'ACP_INSTALL_TIMEOUT',
        'Registry package install timed out',
      )
      terminate('SIGTERM')
    }, timeoutMs)
    const forceKill = { timer: undefined as ReturnType<typeof setTimeout> | undefined }

    const terminate = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        try {
          child.kill(signal)
        } catch {}
      }
      if (signal === 'SIGTERM' && !forceKill.timer) {
        forceKill.timer = setTimeout(() => terminate('SIGKILL'), 1_000)
        forceKill.timer.unref?.()
      }
    }
    const onAbort = () => {
      lifecycleFailure = new PackageMaterializeError(
        'ACP_INSTALL_ABORTED',
        'Registry package install cancelled',
      )
      terminate('SIGTERM')
    }
    const finish = (error?: PackageMaterializeError) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (forceKill.timer) clearTimeout(forceKill.timer)
      input.signal?.removeEventListener('abort', onAbort)
      if (error) rejectPromise(error)
      else resolvePromise()
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-4_096)
    })
    child.once('error', () =>
      finish(new PackageMaterializeError('ACP_INSTALL_FAILED', 'Registry package installer failed')),
    )
    child.once('exit', (code) => {
      if (lifecycleFailure) finish(lifecycleFailure)
      else if (code === 0) finish()
      else {
        void stderrTail
        finish(new PackageMaterializeError('ACP_INSTALL_FAILED', 'Registry package installer failed'))
      }
    })
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) onAbort()
  })
}

export async function materializeNpmPackage(
  input: MaterializeNpmPackageInput,
): Promise<MaterializedNpmPackage> {
  const packageName = exactPackageName(input.packageSpec)
  mkdirSync(input.stagingDir, { recursive: true, mode: 0o700 })
  await runInstaller(input)

  const packageDir = join(input.stagingDir, 'node_modules', ...packageName.split('/'))
  let manifest: { name?: unknown; bin?: unknown }
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as typeof manifest
  } catch {
    throw new PackageMaterializeError(
      'ACP_INSTALL_ENTRY_INVALID',
      'Installed Registry package manifest is unavailable',
    )
  }
  if (manifest.name !== packageName) {
    throw new PackageMaterializeError(
      'ACP_INSTALL_ENTRY_INVALID',
      'Installed Registry package identity does not match the catalog',
    )
  }

  const executable = resolve(packageDir, uniqueBinPath(manifest, packageName))
  const root = realpathSync(input.stagingDir)
  let canonicalExecutable: string
  try {
    canonicalExecutable = realpathSync(executable)
    const stat = lstatSync(canonicalExecutable)
    if (!stat.isFile()) throw new Error('not a file')
  } catch {
    throw new PackageMaterializeError(
      'ACP_INSTALL_ENTRY_INVALID',
      'Registry package executable is unavailable',
    )
  }
  if (!canonicalExecutable.startsWith(`${root}${sep}`)) {
    throw new PackageMaterializeError(
      'ACP_INSTALL_ENTRY_INVALID',
      'Registry package executable escapes its managed installation',
    )
  }
  return {
    packageName,
    executableRelativePath: relative(root, canonicalExecutable).split(sep).join('/'),
  }
}
