import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isLoadedNodePtyModule,
  isLoadedLibsqlModule,
  requiredRuntimePackageNames,
  resolveLibsqlNativePackage,
  runtimeExternalPackageNames,
  unstagedRuntimeImportSpecifiers,
  verifyNodePtyRoundTrip,
} from './runtime-packaging.mjs'

describe('desktop runtime native packages', () => {
  it('maps supported release targets to exact libsql packages', () => {
    assert.equal(resolveLibsqlNativePackage('darwin', 'arm64'), '@libsql/darwin-arm64')
    assert.equal(resolveLibsqlNativePackage('win32', 'x64'), '@libsql/win32-x64-msvc')
    assert.equal(resolveLibsqlNativePackage('linux', 'x64', 'glibc'), '@libsql/linux-x64-gnu')
  })

  it('rejects unsupported release targets instead of guessing', () => {
    assert.throws(
      () => resolveLibsqlNativePackage('darwin', 'x64'),
      /Unsupported desktop runtime target/,
    )
    assert.throws(
      () => resolveLibsqlNativePackage('linux', 'arm64', 'glibc'),
      /Unsupported desktop runtime target/,
    )
    assert.throws(
      () => resolveLibsqlNativePackage('linux', 'x64', 'musl'),
      /Unsupported desktop runtime target/,
    )
  })

  it('stages libsql and node-pty native packages beside the bundle', () => {
    assert.deepEqual(
      requiredRuntimePackageNames({
        platform: 'darwin',
        arch: 'arm64',
      }),
      ['libsql', '@neon-rs/load', 'detect-libc', '@libsql/darwin-arm64', 'node-pty'],
    )
  })

  it('externalizes only staged native packages, not bundleable libsql clients', () => {
    const external = runtimeExternalPackageNames({
      platform: 'darwin',
      arch: 'arm64',
    })

    assert.deepEqual(external, [
      'libsql',
      '@neon-rs/load',
      'detect-libc',
      '@libsql/darwin-arm64',
      'node-pty',
    ])
    assert.equal(external.includes('@libsql/*'), false)
    assert.equal(external.includes('@libsql/client'), false)
  })

  it('detects bare bundle imports that are not present in the staged runtime', () => {
    const staged = ['libsql', '@neon-rs/load', 'detect-libc', 'node-pty']

    assert.deepEqual(
      unstagedRuntimeImportSpecifiers(
        [
          'node:fs',
          'fs/promises',
          './local.mjs',
          'libsql',
          '@neon-rs/load',
          'bufferutil',
          'utf-8-validate',
          '@ast-grep/napi',
          '@libsql/client',
          'node-pty',
        ],
        staged,
      ),
      ['@libsql/client'],
    )
  })

  it('recognizes the libsql CommonJS constructor export', () => {
    function Database() {}
    assert.equal(isLoadedLibsqlModule(Database), true)
    assert.equal(isLoadedLibsqlModule({ Database }), false)
    assert.equal(isLoadedLibsqlModule(null), false)
  })

  it('recognizes node-pty only when its native PTY spawn API is present', () => {
    assert.equal(isLoadedNodePtyModule({ spawn() {} }), true)
    assert.equal(isLoadedNodePtyModule({}), false)
    assert.equal(isLoadedNodePtyModule(null), false)
  })

  it('uses signal-less node-pty cleanup when a Windows runtime smoke times out', async () => {
    const kills: Array<string | undefined> = []
    await assert.rejects(
      verifyNodePtyRoundTrip({
        platform: 'win32',
        cwd: process.cwd(),
        timeoutMs: 1,
        ptyModule: {
          spawn: () => ({
            kill: (signal?: string) => kills.push(signal),
            resize() {},
            write() {},
            onData: () => ({ dispose() {} }),
            onExit: () => ({ dispose() {} }),
          }),
        },
      }),
      /timed out/i,
    )
    assert.deepEqual(kills, [undefined])
  })

  it('Windows smoke does not require stdout columns/rows after resize', async () => {
    // ConPTY often never updates process.stdout.columns after parent resize.
    let wrote = ''
    let resized = false
    await verifyNodePtyRoundTrip({
      platform: 'win32',
      cwd: process.cwd(),
      timeoutMs: 2_000,
      nodeExecutable: process.execPath,
      ptyModule: {
        spawn: (_file: string, args: string[]) => {
          // Execute the real child script via the same node, but drive PTY IO with a fake.
          // Here we only assert the Windows success marker contract via a mock that
          // mirrors parent protocol (READY → resize+write → OK + exit 0).
          assert.match(args.join(' '), /PIHUO_AGENT_PTY_OK/)
          assert.doesNotMatch(args.join(' '), /stdout\.columns/)
          const handlers: {
            data?: (chunk: string) => void
            exit?: (info: { exitCode: number }) => void
          } = {}
          queueMicrotask(() => handlers.data?.('PIHUO_AGENT_PTY_READY\n'))
          return {
            kill() {},
            resize() {
              resized = true
            },
            write(chunk: string) {
              wrote += chunk
              queueMicrotask(() => {
                handlers.data?.('PIHUO_AGENT_PTY_OK\n')
                handlers.exit?.({ exitCode: 0 })
              })
            },
            onData: (cb: (chunk: string) => void) => {
              handlers.data = cb
              return { dispose() {} }
            },
            onExit: (cb: (info: { exitCode: number }) => void) => {
              handlers.exit = cb
              return { dispose() {} }
            },
          }
        },
      },
    })
    assert.equal(resized, true)
    assert.match(wrote, /continue/)
  })
})
