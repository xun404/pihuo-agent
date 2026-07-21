/**
 * Safe host log forwarding for Electron.
 *
 * Electron GUI launches often have stdout/stderr attached to a closed or
 * half-closed pipe. Writing then raises `EPIPE` / `ERR_STREAM_DESTROYED`,
 * which becomes an uncaught exception and kills the desktop shell if unhandled.
 */

export type HostWriteStream = {
  writable?: boolean
  destroyed?: boolean
  write: (chunk: string | Buffer) => unknown
  on?: (event: 'error', listener: (error: NodeJS.ErrnoException) => void) => unknown
}

export function isIgnorableHostWriteError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED'
}

/** Ignore broken-pipe errors so API log drains cannot take down Electron. */
export function ignoreBrokenHostPipe(stream: HostWriteStream | null | undefined): void {
  stream?.on?.('error', (error) => {
    if (isIgnorableHostWriteError(error)) return
  })
}

/**
 * Write child process output to the host stream without throwing on EPIPE.
 * Returns false when the write was skipped or failed with a broken pipe.
 */
export function writeHostLog(
  stream: HostWriteStream | null | undefined,
  prefix: string,
  chunk: unknown,
): boolean {
  if (!stream || stream.destroyed || stream.writable === false) return false
  try {
    stream.write(`${prefix}${chunk}`)
    return true
  } catch (error) {
    if (isIgnorableHostWriteError(error)) return false
    return false
  }
}
