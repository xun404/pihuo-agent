/**
 * Safe, streaming archive extraction for ACP binary installs.
 * Archives are fully preflighted before the first payload file is written.
 */
import {
  chmodSync,
  closeSync,
  createReadStream,
  createWriteStream,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs'
import { dirname, normalize, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'
import yauzl, { type Entry as ZipEntry, type ZipFile } from 'yauzl'
import tar from 'tar-stream'
// @ts-expect-error unbzip2-stream does not publish types
import bz2 from 'unbzip2-stream'

export const ARCHIVE_LIMITS = {
  maxArchiveBytes: 200 * 1024 * 1024,
  maxEntryBytes: 150 * 1024 * 1024,
  maxTotalUncompressedBytes: 400 * 1024 * 1024,
  maxEntries: 20_000,
  maxCompressionRatio: 200,
} as const

type ArchiveLimits = {
  [Key in keyof typeof ARCHIVE_LIMITS]: number
}

export interface ExtractArchiveOptions {
  limits?: Partial<ArchiveLimits>
}

function resolveArchiveLimits(overrides?: Partial<ArchiveLimits>): ArchiveLimits {
  const limits = { ...ARCHIVE_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new AcpArchiveError(`Invalid archive limit: ${name}`)
    }
  }
  return limits
}

export class AcpArchiveError extends Error {
  readonly code = 'ACP_INSTALL_ARCHIVE_UNSAFE'

  constructor(message: string) {
    super(message)
    this.name = 'AcpArchiveError'
  }
}

/** Reject path forms which could escape the staging root on any supported OS. */
export function safeResolveEntryPath(destRoot: string, entryName: string): string {
  if (!entryName || typeof entryName !== 'string') {
    throw new AcpArchiveError('Empty archive entry name')
  }
  if (entryName.includes('\0')) {
    throw new AcpArchiveError('Archive entry contains NUL')
  }
  const name = entryName.replaceAll('\\', '/')
  if (/^[a-zA-Z]:/.test(name) || name.startsWith('//') || name.includes('://')) {
    throw new AcpArchiveError('Absolute or UNC archive path rejected')
  }
  if (name.startsWith('/')) {
    throw new AcpArchiveError('Absolute archive path rejected')
  }
  if (name.split('/').includes('..')) {
    throw new AcpArchiveError('Archive path traversal rejected')
  }
  const normalized = normalize(name)
  if (normalized === '.') throw new AcpArchiveError('Empty archive entry name')
  if (
    normalized === '..' ||
    normalized.startsWith(`..${sep}`) ||
    normalized.split(sep).includes('..')
  ) {
    throw new AcpArchiveError('Archive path traversal rejected')
  }
  const root = resolve(destRoot)
  const full = resolve(root, normalized)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new AcpArchiveError('Archive entry escapes staging root')
  }
  return full
}

export function detectArchiveKind(
  filePath: string,
  bytes?: Buffer,
): 'zip' | 'tar.gz' | 'tar.bz2' | 'raw' {
  let suffixPath = filePath
  try {
    suffixPath = new URL(filePath).pathname
  } catch {
    suffixPath = filePath.split(/[?#]/, 1)[0] ?? filePath
  }
  const lower = suffixPath.toLowerCase()
  const suffixKind = lower.endsWith('.zip')
    ? 'zip'
    : lower.endsWith('.tar.gz') || lower.endsWith('.tgz')
      ? 'tar.gz'
      : lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')
        ? 'tar.bz2'
        : undefined
  let magicKind: 'zip' | 'tar.gz' | 'tar.bz2' | undefined
  if (bytes && bytes.length >= 3) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) magicKind = 'zip'
    else if (bytes[0] === 0x1f && bytes[1] === 0x8b) magicKind = 'tar.gz'
    else if (bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68) magicKind = 'tar.bz2'
  }
  if (suffixKind && magicKind && suffixKind !== magicKind) {
    throw new AcpArchiveError('Archive suffix does not match downloaded content')
  }
  return magicKind ?? suffixKind ?? 'raw'
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function archiveSize(path: string, limits: ArchiveLimits): number {
  let size: number
  try {
    size = statSync(path).size
  } catch {
    throw new AcpArchiveError('Archive file is unavailable')
  }
  if (size > limits.maxArchiveBytes) {
    throw new AcpArchiveError('Archive exceeds maxArchiveBytes')
  }
  return size
}

export function readArchiveMagic(path: string): Buffer {
  const bytes = Buffer.alloc(4)
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const count = readSync(fd, bytes, 0, bytes.length, 0)
    return bytes.subarray(0, count)
  } catch {
    throw new AcpArchiveError('Archive file is unavailable')
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // best effort close only
      }
    }
  }
}

function assertSizeLimits(
  archiveBytes: number,
  uncompressed: number,
  entries: number,
  limits: ArchiveLimits,
): void {
  if (uncompressed > limits.maxTotalUncompressedBytes) {
    throw new AcpArchiveError('Uncompressed size exceeds limit')
  }
  if (entries > limits.maxEntries) {
    throw new AcpArchiveError('Entry count exceeds limit')
  }
  if (archiveBytes > 0 && uncompressed / archiveBytes > limits.maxCompressionRatio) {
    throw new AcpArchiveError('Compression ratio exceeds limit')
  }
}

function assertEntrySize(size: number, limits: ArchiveLimits, compressedSize?: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxEntryBytes) {
    throw new AcpArchiveError('Single entry exceeds maxEntryBytes')
  }
  if (
    compressedSize !== undefined &&
    size > 0 &&
    size / Math.max(1, compressedSize) > limits.maxCompressionRatio
  ) {
    throw new AcpArchiveError('Entry compression ratio exceeds limit')
  }
}

function addArchivePath(
  paths: Map<string, 'file' | 'directory'>,
  destRoot: string,
  fullPath: string,
  kind: 'file' | 'directory',
): void {
  const key = fullPath.normalize('NFC').toLocaleLowerCase('en-US')
  const existing = paths.get(key)
  if (existing) {
    if (existing === 'directory' && kind === 'directory') return
    throw new AcpArchiveError('Duplicate or conflicting archive entry path')
  }
  const root = resolve(destRoot)
  for (let parent = dirname(fullPath); parent !== root; parent = dirname(parent)) {
    const parentKey = parent.normalize('NFC').toLocaleLowerCase('en-US')
    if (paths.get(parentKey) === 'file') {
      throw new AcpArchiveError('Archive entry descends from a file')
    }
    paths.set(parentKey, 'directory')
    if (parent === dirname(parent)) break
  }
  paths.set(key, kind)
}

function zipEntryKind(entry: ZipEntry): 'file' | 'directory' {
  const unixType = (entry.externalFileAttributes >>> 16) & 0xffff & 0xf000
  if (unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000) {
    throw new AcpArchiveError('Unsupported ZIP entry type')
  }
  const directory = entry.fileName.endsWith('/') || unixType === 0x4000
  if (directory && entry.uncompressedSize !== 0) {
    throw new AcpArchiveError('Invalid ZIP directory entry')
  }
  return directory ? 'directory' : 'file'
}

async function forEachZipEntry(
  archivePath: string,
  visit: (zip: ZipFile, entry: ZipEntry) => Promise<void> | void,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        rejectPromise(new AcpArchiveError('Invalid ZIP archive'))
        return
      }
      let settled = false
      const reject = () => {
        if (settled) return
        settled = true
        zip.close()
        rejectPromise(new AcpArchiveError('Invalid ZIP archive entry'))
      }
      zip.on('error', reject)
      zip.on('end', () => {
        if (settled) return
        settled = true
        resolvePromise()
      })
      zip.on('entry', (entry) => {
        Promise.resolve()
          .then(() => visit(zip, entry))
          .then(() => zip.readEntry(), reject)
      })
      zip.readEntry()
    })
  })
}

function readZipLocalFlags(archivePath: string, entry: ZipEntry): number {
  const header = Buffer.alloc(30)
  let fd: number | undefined
  try {
    fd = openSync(archivePath, 'r')
    const count = readSync(fd, header, 0, header.length, entry.relativeOffsetOfLocalHeader)
    if (count !== header.length || header.readUInt32LE(0) !== 0x04034b50) {
      throw new AcpArchiveError('Invalid ZIP local header')
    }
    return header.readUInt16LE(6)
  } catch (error) {
    if (error instanceof AcpArchiveError) throw error
    throw new AcpArchiveError('Invalid ZIP local header')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

async function openZipEntryStream(zip: ZipFile, entry: ZipEntry): Promise<Readable> {
  return new Promise<Readable>((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (error, readable) => {
      if (error || !readable) rejectPromise(error ?? new Error('missing ZIP entry stream'))
      else resolvePromise(readable)
    })
  })
}

async function preflightZip(
  archivePath: string,
  destRoot: string,
  bytes: number,
  limits: ArchiveLimits,
): Promise<number> {
  let entries = 0
  let total = 0
  const paths = new Map<string, 'file' | 'directory'>()
  await forEachZipEntry(archivePath, async (zip, entry) => {
    entries += 1
    const dest = safeResolveEntryPath(destRoot, entry.fileName)
    const kind = zipEntryKind(entry)
    addArchivePath(paths, destRoot, dest, kind)
    assertEntrySize(entry.uncompressedSize, limits, entry.compressedSize)
    assertSizeLimits(bytes, total, entries, limits)
    const localFlags = readZipLocalFlags(archivePath, entry)
    if ((entry.generalPurposeBitFlag & 1) !== 0 || (localFlags & 1) !== 0) {
      throw new AcpArchiveError('Encrypted ZIP entries are not supported')
    }
    if (localFlags !== entry.generalPurposeBitFlag) {
      throw new AcpArchiveError('ZIP local and central flags differ')
    }
    const stream = await openZipEntryStream(zip, entry)
    let actual = 0
    for await (const chunk of stream) {
      actual += Buffer.byteLength(chunk)
      assertEntrySize(actual, limits, entry.compressedSize)
      assertSizeLimits(bytes, total + actual, entries, limits)
    }
    if (actual !== entry.uncompressedSize) {
      throw new AcpArchiveError('ZIP entry size does not match its payload')
    }
    total += actual
  })
  return total
}

async function extractZip(archivePath: string, destRoot: string): Promise<void> {
  await forEachZipEntry(archivePath, async (zip, entry) => {
    const dest = safeResolveEntryPath(destRoot, entry.fileName)
    if (zipEntryKind(entry) === 'directory') {
      mkdirSync(dest, { recursive: true, mode: 0o700 })
      return
    }
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
    const stream = await openZipEntryStream(zip, entry)
    await pipeline(stream, createWriteStream(dest, { mode: 0o600, flags: 'wx' }))
  })
}

function compressedTarInput(path: string, kind: 'tar.gz' | 'tar.bz2'): Readable {
  const source = createReadStream(path)
  return source.pipe(kind === 'tar.gz' ? createGunzip() : bz2())
}

function countExpandedBytes(
  archiveBytes: number,
  limits: ArchiveLimits,
): { stream: Transform; total: () => number } {
  let expandedBytes = 0
  return {
    stream: new Transform({
      transform(chunk, _encoding, callback) {
        try {
          expandedBytes += Buffer.byteLength(chunk)
          assertSizeLimits(archiveBytes, expandedBytes, 0, limits)
          callback(null, chunk)
        } catch (error) {
          callback(error as Error)
        }
      },
    }),
    total: () => expandedBytes,
  }
}

async function processTar(
  input: Readable,
  destRoot: string,
  archiveBytes: number,
  write: boolean,
  limits: ArchiveLimits,
): Promise<number> {
  const extract = tar.extract()
  let entries = 0
  let total = 0
  const paths = new Map<string, 'file' | 'directory'>()
  extract.on('entry', (header, stream, next) => {
    try {
      entries += 1
      const kind = header.type
      if (kind !== 'file' && kind !== 'directory') {
        stream.resume()
        next(new AcpArchiveError('Unsupported TAR entry type'))
        return
      }
      const dest = safeResolveEntryPath(destRoot, header.name)
      addArchivePath(paths, destRoot, dest, kind)
      const size = header.size ?? 0
      assertEntrySize(size, limits)
      total += size
      assertSizeLimits(archiveBytes, total, entries, limits)
      if (!write) {
        stream.once('end', next)
        stream.resume()
        return
      }
      if (kind === 'directory') {
        if (size !== 0) throw new AcpArchiveError('Invalid TAR directory entry')
        mkdirSync(dest, { recursive: true, mode: 0o700 })
        stream.once('end', next)
        stream.resume()
        return
      }
      mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
      pipeline(stream, createWriteStream(dest, { mode: 0o600, flags: 'wx' })).then(
        () => next(),
        (error) => next(error),
      )
    } catch (error) {
      stream.resume()
      next(error as Error)
    }
  })
  const expanded = countExpandedBytes(archiveBytes, limits)
  try {
    await pipeline(input, expanded.stream, extract)
  } catch (error) {
    if (error instanceof AcpArchiveError) throw error
    throw new AcpArchiveError('Invalid compressed TAR archive')
  }
  return total
}

/** Extract a supported archive. Raw payloads require their declared relative executable path. */
export async function extractArchiveSafe(
  archivePath: string,
  destRoot: string,
  kind?: 'zip' | 'tar.gz' | 'tar.bz2' | 'raw',
  rawExecutableRelativePath = 'agent-binary',
  options: ExtractArchiveOptions = {},
): Promise<{ uncompressedBytes: number; kind: string }> {
  const limits = resolveArchiveLimits(options.limits)
  const bytes = archiveSize(archivePath, limits)
  const detected = kind ?? detectArchiveKind(archivePath, readArchiveMagic(archivePath))
  mkdirSync(destRoot, { recursive: true, mode: 0o700 })
  if (detected === 'zip') {
    const total = await preflightZip(archivePath, destRoot, bytes, limits)
    await extractZip(archivePath, destRoot)
    return { uncompressedBytes: total, kind: detected }
  }
  if (detected === 'tar.gz' || detected === 'tar.bz2') {
    const total = await processTar(
      compressedTarInput(archivePath, detected),
      destRoot,
      bytes,
      false,
      limits,
    )
    await processTar(compressedTarInput(archivePath, detected), destRoot, bytes, true, limits)
    return { uncompressedBytes: total, kind: detected }
  }
  assertEntrySize(bytes, limits)
  assertSizeLimits(bytes, bytes, 1, limits)
  const dest = safeResolveEntryPath(destRoot, rawExecutableRelativePath)
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
  try {
    await pipeline(
      createReadStream(archivePath),
      createWriteStream(dest, { mode: 0o700, flags: 'wx' }),
    )
    chmodSync(dest, 0o700)
  } catch (error) {
    if (error instanceof AcpArchiveError) throw error
    throw new AcpArchiveError('Raw binary extraction failed')
  }
  return { uncompressedBytes: bytes, kind: 'raw' }
}

export function assertExecutableInsideStaging(stagingRoot: string, relativeCmd: string): string {
  const full = safeResolveEntryPath(stagingRoot, relativeCmd)
  try {
    const stat = lstatSync(full)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file')
    chmodSync(full, 0o700)
    return full
  } catch {
    throw new AcpArchiveError('Declared executable is not an ordinary regular file')
  }
}
