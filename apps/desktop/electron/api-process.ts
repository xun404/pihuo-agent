export interface ApiProcessSource {
  readonly pid?: number
  readonly stdout?: NodeJS.ReadableStream | null
  readonly stderr?: NodeJS.ReadableStream | null
  kill(...args: unknown[]): boolean
  once(event: string, listener: (...args: unknown[]) => void): unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface ManagedApiProcess {
  readonly pid: number | undefined
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  readonly exited: boolean
  kill(force?: boolean): boolean
  waitForSpawn(timeoutMs: number): Promise<number | undefined>
  waitForExit(timeoutMs: number): Promise<boolean>
  onError(listener: (error: unknown) => void): void
  onExit(listener: (code: number | null) => void): void
}

function normalizeExitCode(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

export function createManagedApiProcess(source: ApiProcessSource): ManagedApiProcess {
  let exited = false
  source.once('exit', () => {
    exited = true
  })

  return {
    get pid() {
      return source.pid
    },
    get stdout() {
      return source.stdout ?? null
    },
    get stderr() {
      return source.stderr ?? null
    },
    get exited() {
      return exited
    },
    kill(force = false) {
      if (exited) return false
      try {
        return force ? source.kill('SIGKILL') : source.kill()
      } catch {
        return false
      }
    },
    async waitForSpawn(timeoutMs) {
      if (source.pid) return source.pid
      return await new Promise<number | undefined>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (pid: number | undefined) => {
          if (timer) clearTimeout(timer)
          source.removeListener('spawn', onSpawn)
          resolve(pid)
        }
        const onSpawn = () => finish(source.pid)
        source.once('spawn', onSpawn)
        timer = setTimeout(() => finish(undefined), timeoutMs)
      })
    },
    async waitForExit(timeoutMs) {
      if (exited) return true
      return await new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (didExit: boolean) => {
          if (timer) clearTimeout(timer)
          source.removeListener('exit', onExit)
          resolve(didExit)
        }
        const onExit = () => finish(true)
        source.once('exit', onExit)
        timer = setTimeout(() => finish(false), timeoutMs)
      })
    },
    onError(listener) {
      source.on('error', (error) => listener(error))
    },
    onExit(listener) {
      source.on('exit', (code) => listener(normalizeExitCode(code)))
    },
  }
}
