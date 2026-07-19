import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import tar, { type Headers as TarHeader } from 'tar-stream'
import {
  AcpArchiveError,
  assertExecutableInsideStaging,
  detectArchiveKind,
  extractArchiveSafe,
  safeResolveEntryPath,
} from './acp-archive-reader.js'

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipFixture(
  entries: Array<{
    name: string
    data?: string
    unixMode?: number
    flags?: number
    localFlags?: number
  }>,
): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.from(entry.data ?? '')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.localFlags ?? entry.flags ?? 0, 6)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(3 << 8, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.flags ?? 0, 8)
    central.writeUInt32LE(crc32(data), 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((entry.unixMode ?? 0o100600) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

async function tarFixture(entries: Array<{ header: TarHeader; body?: Buffer }>): Promise<Buffer> {
  const pack = tar.pack()
  const chunks: Buffer[] = []
  pack.on('data', (chunk: Buffer) => chunks.push(chunk))
  const ended = new Promise<Buffer>((resolvePromise, rejectPromise) => {
    pack.once('end', () => resolvePromise(Buffer.concat(chunks)))
    pack.once('error', rejectPromise)
  })
  for (const entry of entries) {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      pack.entry(entry.header, entry.body ?? Buffer.alloc(0), (error) => {
        if (error) rejectPromise(error)
        else resolvePromise()
      })
    })
  }
  pack.finalize()
  return ended
}

function withTarType(rawTar: Buffer, type: string): Buffer {
  const result = Buffer.from(rawTar)
  result[156] = type.charCodeAt(0)
  result.fill(0x20, 148, 156)
  let sum = 0
  for (let i = 0; i < 512; i += 1) sum += result[i]!
  result.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return result
}

describe('acp-archive-reader path safety', () => {
  it('rejects traversal and absolute paths', () => {
    const root = '/tmp/stage-root'
    assert.throws(() => safeResolveEntryPath(root, '../etc/passwd'), AcpArchiveError)
    assert.throws(() => safeResolveEntryPath(root, 'bin/../agent'), AcpArchiveError)
    assert.throws(() => safeResolveEntryPath(root, '/etc/passwd'), AcpArchiveError)
    assert.throws(() => safeResolveEntryPath(root, 'C:\\Windows\\system32'), AcpArchiveError)
    assert.throws(() => safeResolveEntryPath(root, 'foo\0bar'), AcpArchiveError)
    const ok = safeResolveEntryPath(root, 'bin/agent')
    assert.ok(ok.endsWith(`${join('bin', 'agent')}`) || ok.includes('bin'))
  })
})

describe('acp-archive-reader extract', () => {
  let dir: string

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-arc-'))
  })

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('extracts a simple zip without a system archive command', async () => {
    const zipPath = join(dir, 'ok.zip')
    writeFileSync(zipPath, zipFixture([{ name: 'hello.txt', data: 'hi' }]))
    const dest = join(dir, 'out-zip')
    const result = await extractArchiveSafe(zipPath, dest)
    assert.equal(result.kind, 'zip')
    assert.ok(existsSync(join(dest, 'hello.txt')))
    assert.equal(readFileSync(join(dest, 'hello.txt'), 'utf8'), 'hi')
  })

  it('validates every zip entry before writing any files', async () => {
    const zipPath = join(dir, 'unsafe.zip')
    writeFileSync(
      zipPath,
      zipFixture([
        { name: 'safe.txt', data: 'must-not-be-written' },
        { name: '../escape.txt', data: 'escape' },
      ]),
    )
    const dest = join(dir, 'out-unsafe')
    await assert.rejects(() => extractArchiveSafe(zipPath, dest), AcpArchiveError)
    assert.equal(existsSync(join(dest, 'safe.txt')), false)
  })

  it('streams every ZIP payload during preflight before writing', async () => {
    const zipPath = join(dir, 'encrypted-second.zip')
    writeFileSync(
      zipPath,
      zipFixture([
        { name: 'safe.txt', data: 'must-not-be-written' },
        { name: 'encrypted.txt', data: 'ciphertext', localFlags: 1 },
      ]),
    )
    const dest = join(dir, 'out-encrypted-second')
    await assert.rejects(() => extractArchiveSafe(zipPath, dest), AcpArchiveError)
    assert.equal(existsSync(join(dest, 'safe.txt')), false)
  })

  it('rejects duplicate archive file paths before writing', async () => {
    const zipPath = join(dir, 'duplicate.zip')
    writeFileSync(
      zipPath,
      zipFixture([
        { name: 'same.txt', data: 'first' },
        { name: 'same.txt', data: 'second' },
      ]),
    )
    const dest = join(dir, 'out-duplicate')
    await assert.rejects(() => extractArchiveSafe(zipPath, dest), AcpArchiveError)
    assert.equal(existsSync(join(dest, 'same.txt')), false)
  })

  it('detects zip magic', () => {
    assert.equal(detectArchiveKind('x.bin', Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'zip')
  })

  it('detects archive suffixes from URL pathname and reconciles extensionless magic', () => {
    assert.equal(detectArchiveKind('https://example.com/agent.zip?download=1'), 'zip')
    assert.equal(
      detectArchiveKind('https://example.com/download?id=1', Buffer.from([0x50, 0x4b, 0x03, 0x04])),
      'zip',
    )
  })

  it('extracts tgz and tbz2 fixtures without system archive commands', async () => {
    const fixtures = [
      {
        name: 'agent.tgz',
        base64:
          'H4sIAAAAAAAC/+3NMQrCQBQE0F97Ci8grixLzhMhxECIIcbG07ukEewVxPeaGaaZ8zAd276b1vicVDWlbFm9Z0qn/Orb3pScY5/iC+63tV3qZfynSzeO10P/GOZdAAAAAAAAAAAA8DuecdxppQAoAAA=',
        expected: 'hello-gzip\n',
      },
      {
        name: 'agent.tbz2',
        base64:
          'QlpoOTFBWSZTWdVpqB8AAG/7gMqQAIBAAuqAAIBy5d4QCAggAFQ0p6ho000Dahp6hp6gkomhoAAB6gfd1D0IJ4IQixroklMZkCHAzxmulFBwjMyB5vliEFriTaSKs2VvKUMzc3LM/UiID8XckU4UJDVaagfA',
        expected: 'hello-bzip\n',
      },
    ]
    for (const fixture of fixtures) {
      const archive = join(dir, fixture.name)
      const dest = join(dir, `out-${fixture.name}`)
      writeFileSync(archive, Buffer.from(fixture.base64, 'base64'))
      await extractArchiveSafe(archive, dest)
      assert.equal(readFileSync(join(dest, 'bin/agent'), 'utf8'), fixture.expected)
    }
  })

  it('counts every decompressed TAR byte for total and ratio limits', async () => {
    const fixtures = [
      {
        name: 'inflated.tgz',
        base64:
          'H4sIAAAAAAAC/+3OuQ2AMBAEwCuFEoxk2fW4BR6J8jFEiBwImEn2tMlei+elruR8ZnfPbrzcR19SrTGkF36LdV7a1Cfjn7YAAAAAAAAAAAAAAAAAAAAAAOALO49sjBQASAAA',
      },
      {
        name: 'inflated.tbz2',
        base64:
          'QlpoOTFBWSZTWTcWOpkAAKzfgMmAQABlgCAAAADgAB5ACAggAFRGp6gAaDQJIkYh6Rkxr2g6EBngEIIvFSPOqCEDA0OJ2EfOEKrUvhcka7tmb0wAiJ8XckU4UJA3FjqZ',
      },
    ]
    for (const fixture of fixtures) {
      const archive = join(dir, fixture.name)
      writeFileSync(archive, Buffer.from(fixture.base64, 'base64'))
      await assert.rejects(
        () =>
          extractArchiveSafe(archive, join(dir, `${fixture.name}-total`), undefined, 'agent', {
            limits: {
              maxTotalUncompressedBytes: 4 * 1024,
              maxCompressionRatio: 10_000,
            },
          }),
        AcpArchiveError,
      )
      await assert.rejects(
        () =>
          extractArchiveSafe(archive, join(dir, `${fixture.name}-ratio`), undefined, 'agent', {
            limits: {
              maxTotalUncompressedBytes: 1024 * 1024,
              maxCompressionRatio: 2,
            },
          }),
        AcpArchiveError,
      )
    }
  })

  it('enforces parameterized archive, entry-count, entry-size, and total limits', async () => {
    const archive = join(dir, 'small-limits.zip')
    writeFileSync(
      archive,
      zipFixture([
        { name: 'a', data: '1234' },
        { name: 'b', data: '5678' },
      ]),
    )
    const cases = [
      { maxArchiveBytes: 16 },
      { maxEntries: 1 },
      { maxEntryBytes: 3 },
      { maxTotalUncompressedBytes: 7 },
    ]
    for (const [index, limits] of cases.entries()) {
      await assert.rejects(
        () =>
          extractArchiveSafe(archive, join(dir, `small-limit-${index}`), undefined, 'agent', {
            limits,
          }),
        AcpArchiveError,
      )
    }
  })

  it('rejects TAR hardlinks, devices, FIFO, and socket-like entries', async () => {
    const entries: TarHeader[] = [
      { name: 'hard', type: 'link', linkname: 'target' },
      { name: 'char', type: 'character-device' },
      { name: 'block', type: 'block-device' },
      { name: 'fifo', type: 'fifo' },
    ]
    for (const [index, header] of entries.entries()) {
      const archive = join(dir, `special-${index}.tgz`)
      writeFileSync(archive, gzipSync(await tarFixture([{ header }])))
      await assert.rejects(
        () => extractArchiveSafe(archive, join(dir, `special-${index}`)),
        AcpArchiveError,
      )
    }
    const rawSocket = withTarType(
      await tarFixture([{ header: { name: 'socket', type: 'file' }, body: Buffer.alloc(0) }]),
      's',
    )
    const socketArchive = join(dir, 'socket.tgz')
    writeFileSync(socketArchive, gzipSync(rawSocket))
    await assert.rejects(
      () => extractArchiveSafe(socketArchive, join(dir, 'socket')),
      AcpArchiveError,
    )
  })

  it('rejects case-colliding archive paths before writing', async () => {
    const archive = join(dir, 'case-collision.zip')
    writeFileSync(
      archive,
      zipFixture([
        { name: 'Bin/Agent', data: 'one' },
        { name: 'bin/agent', data: 'two' },
      ]),
    )
    const dest = join(dir, 'case-collision')
    await assert.rejects(() => extractArchiveSafe(archive, dest), AcpArchiveError)
    assert.equal(existsSync(join(dest, 'Bin/Agent')), false)
  })

  it('rejects TAR links during preflight before writing', async () => {
    const archive = join(dir, 'link.tgz')
    writeFileSync(
      archive,
      Buffer.from(
        'H4sIAAAAAAAC/+3OOwqEQBAE0DmKJ1BHBj2PKwayi4if++9gqLGB8B4F1VnXZ5qr3zR/w4PqrE3p7Oza9zvG2KVQNGVZ5Yzb0C/jU+OObe/X/D4AAAAAAAAAAADAe/wBYlv4KAAoAAA=',
        'base64',
      ),
    )
    const dest = join(dir, 'out-link')
    await assert.rejects(
      () => extractArchiveSafe(archive, dest),
      (error: unknown) =>
        error instanceof AcpArchiveError && error.code === 'ACP_INSTALL_ARCHIVE_UNSAFE',
    )
    assert.equal(existsSync(join(dest, 'bin/link')), false)
  })

  it('writes raw binary to the manifest-declared executable path', async () => {
    const raw = join(dir, 'raw.bin')
    writeFileSync(raw, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x02]))
    const dest = join(dir, 'out-raw')
    const r = await extractArchiveSafe(raw, dest, 'raw', 'nested/bin/agent')
    assert.equal(r.kind, 'raw')
    assert.ok(existsSync(join(dest, 'nested/bin/agent')))
    assert.equal(existsSync(join(dest, 'agent-binary')), false)
  })

  it('rejects symlinks and directories as the final executable', () => {
    const dest = join(dir, 'exec-validation')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'real'), 'ok')
    symlinkSync('real', join(dest, 'link'))
    mkdirSync(join(dest, 'directory'))
    assert.throws(
      () => assertExecutableInsideStaging(dest, 'link'),
      (error: unknown) => error instanceof AcpArchiveError && !error.message.includes(dest),
    )
    assert.throws(
      () => assertExecutableInsideStaging(dest, 'directory'),
      (error: unknown) => error instanceof AcpArchiveError && !error.message.includes(dest),
    )
  })
})
