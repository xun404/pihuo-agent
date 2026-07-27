import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs'
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
  launchMode: 'node' | 'direct'
}

export class PackageMaterializeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PackageMaterializeError'
  }
}

function exactPackageIdentity(packageSpec: string): { name: string; version: string } {
  const spec = packageSpec.trim()
  const versionAt = spec.lastIndexOf('@')
  const scopedSlash = spec.startsWith('@') ? spec.indexOf('/') : -1
  const name = versionAt > Math.max(0, scopedSlash) ? spec.slice(0, versionAt) : ''
  const version = versionAt >= 0 ? spec.slice(versionAt + 1) : ''
  const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
  const packageName = /^(?:[a-z0-9][a-z0-9._~-]*|@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*)$/u
  if (!packageName.test(name) || !exactVersion.test(version)) {
    throw new PackageMaterializeError(
      'ACP_INSTALL_ENTRY_INVALID',
      'Registry package must use an exact package name and version',
    )
  }
  return { name, version }
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
    const processGroupAlive = (pid: number): boolean => {
      if (process.platform === 'win32') return false
      try {
        process.kill(-pid, 0)
        return true
      } catch {
        return false
      }
    }
    const pause = (ms: number) => new Promise<void>((resolvePause) => setTimeout(resolvePause, ms))
    const terminateTree = async (): Promise<boolean> => {
      if (!child.pid) return child.exitCode !== null
      if (process.platform === 'win32') {
        const taskkillSucceeded = await new Promise<boolean>((resolveKill) => {
          const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          })
          let done = false
          const finishKill = (ok: boolean) => {
            if (done) return
            done = true
            clearTimeout(killDeadline)
            resolveKill(ok)
          }
          const killDeadline = setTimeout(() => {
            try {
              killer.kill('SIGKILL')
            } catch {}
            finishKill(false)
          }, 2_000)
          killer.once('error', () => {
            finishKill(false)
          })
          killer.once('exit', (code) => finishKill(code === 0))
        })
        if (!taskkillSucceeded && child.exitCode === null) {
          try {
            child.kill('SIGKILL')
          } catch {}
        }
        const windowsReapDeadline = Date.now() + 2_000
        while (child.exitCode === null && Date.now() < windowsReapDeadline) await pause(25)
        return taskkillSucceeded && child.exitCode !== null
      }
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {}
      }
      const gracefulDeadline = Date.now() + 1_000
      while (processGroupAlive(child.pid) && Date.now() < gracefulDeadline) await pause(25)
      if (processGroupAlive(child.pid)) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          try {
            child.kill('SIGKILL')
          } catch {}
        }
      }
      const reapDeadline = Date.now() + 1_000
      while (processGroupAlive(child.pid) && Date.now() < reapDeadline) await pause(25)
      return !processGroupAlive(child.pid)
    }
    const failLifecycle = (error: PackageMaterializeError) => {
      if (lifecycleFailure) return
      lifecycleFailure = error
      void terminateTree().then((cleaned) => {
        finish(
          cleaned
            ? error
            : new PackageMaterializeError(
                'ACP_INSTALL_CLEANUP_FAILED',
                'Registry package installer cleanup failed',
              ),
        )
      })
    }
    const deadline = setTimeout(() => {
      failLifecycle(
        new PackageMaterializeError('ACP_INSTALL_TIMEOUT', 'Registry package install timed out'),
      )
    }, timeoutMs)
    const onAbort = () => {
      failLifecycle(
        new PackageMaterializeError('ACP_INSTALL_ABORTED', 'Registry package install cancelled'),
      )
    }
    const finish = (error?: PackageMaterializeError) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      input.signal?.removeEventListener('abort', onAbort)
      if (error) rejectPromise(error)
      else resolvePromise()
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-4_096)
    })
    child.once('error', () =>
      finish(
        new PackageMaterializeError('ACP_INSTALL_FAILED', 'Registry package installer failed'),
      ),
    )
    child.once('exit', (code) => {
      if (lifecycleFailure) return
      if (code === 0) finish()
      else {
        void stderrTail
        finish(
          new PackageMaterializeError('ACP_INSTALL_FAILED', 'Registry package installer failed'),
        )
      }
    })
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) onAbort()
  })
}

export async function materializeNpmPackage(
  input: MaterializeNpmPackageInput,
): Promise<MaterializedNpmPackage> {
  const { name: packageName, version: packageVersion } = exactPackageIdentity(input.packageSpec)
  mkdirSync(input.stagingDir, { recursive: true, mode: 0o700 })
  await runInstaller(input)

  const packageDir = join(input.stagingDir, 'node_modules', ...packageName.split('/'))
  let manifest: { name?: unknown; version?: unknown; bin?: unknown }
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as typeof manifest
  } catch {
    throw new PackageMaterializeError(
      'ACP_INSTALL_ENTRY_INVALID',
      'Installed Registry package manifest is unavailable',
    )
  }
  if (manifest.name !== packageName || manifest.version !== packageVersion) {
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
  const headerBuffer = Buffer.alloc(256)
  const headerFd = openSync(canonicalExecutable, 'r')
  let headerBytes = 0
  try {
    headerBytes = readSync(headerFd, headerBuffer, 0, headerBuffer.length, 0)
  } finally {
    closeSync(headerFd)
  }
  const header = headerBuffer.subarray(0, headerBytes)
  const headerText = header.toString('utf8')
  const hasShebang = headerText.startsWith('#!')
  const nodeShebang = hasShebang && /^#![^\r\n]*\bnode(?:\.exe)?\b/iu.test(headerText)
  const javascriptWithoutShebang = !hasShebang && /\.(?:cjs|mjs|js)$/iu.test(canonicalExecutable)
  const nativeExecutable =
    (header[0] === 0x7f && header.subarray(1, 4).toString('ascii') === 'ELF') ||
    (header[0] === 0x4d && header[1] === 0x5a) ||
    ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(
      header.subarray(0, 4).toString('hex'),
    )
  const launchMode =
    nodeShebang || javascriptWithoutShebang ? 'node' : nativeExecutable ? 'direct' : undefined
  if (!launchMode) {
    throw new PackageMaterializeError(
      'ACP_INSTALL_ENTRY_INVALID',
      'Registry package executable uses an unsupported interpreter',
    )
  }
  return {
    packageName,
    executableRelativePath: relative(root, canonicalExecutable).split(sep).join('/'),
    launchMode,
  }
}
