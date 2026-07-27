import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'node:test'
import {
  materializeNpmPackage,
  type MaterializeNpmPackageInput,
} from './acp-package-materializer.js'

const FAKE_NPM = fileURLToPath(new URL('./fixtures/fake-npm-installer.ts', import.meta.url))
const TSX_LOADER = fileURLToPath(import.meta.resolve('tsx'))
const tempDirs: string[] = []

function fixture(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'acp-package-materializer-'))
  tempDirs.push(root)
  const stagingDir = join(root, 'staging')
  const traceFile = join(root, 'trace.log')
  const input: MaterializeNpmPackageInput = {
    packageSpec: '@example/agent@1.2.3',
    stagingDir,
    npmCommand: process.execPath,
    npmArgsPrefix: ['--import', TSX_LOADER, FAKE_NPM],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ACP_FAKE_NPM_MODE: mode,
      ACP_FAKE_NPM_TRACE_FILE: traceFile,
    },
    timeoutMs: 2_000,
  }
  return {
    stagingDir,
    traceFile,
    input,
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('materializeNpmPackage', () => {
  it('installs the exact package into staging and resolves its unique local bin', async () => {
    const { input, stagingDir, traceFile } = fixture()
    const result = await materializeNpmPackage(input)

    assert.equal(result.packageName, '@example/agent')
    assert.equal(result.executableRelativePath, 'node_modules/@example/agent/dist/cli.js')
    assert.equal(result.launchMode, 'node')
    assert.equal(existsSync(join(stagingDir, result.executableRelativePath)), true)
    assert.match(readFileSync(traceFile, 'utf8'), /start:success[\s\S]*complete/u)
  })

  it('recognizes native npm bins for direct execution instead of forcing Node', async () => {
    const { input } = fixture('native-bin')
    const result = await materializeNpmPackage(input)
    assert.equal(result.launchMode, 'direct')
    assert.match(result.executableRelativePath, /\/dist\/agent$/u)
  })

  it('terminates a stalled installer at the materialization deadline', async () => {
    const { input, traceFile } = fixture('hang')
    input.timeoutMs = 300

    await assert.rejects(
      () => materializeNpmPackage(input),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & { code?: string }).code === 'ACP_INSTALL_TIMEOUT',
    )
    assert.match(readFileSync(traceFile, 'utf8'), /signal:SIGTERM/u)
  })

  it('terminates a stalled installer when registration is cancelled', async () => {
    const { input, traceFile } = fixture('hang')
    const controller = new AbortController()
    input.signal = controller.signal
    setTimeout(() => controller.abort(), 300)

    await assert.rejects(
      () => materializeNpmPackage(input),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & { code?: string }).code === 'ACP_INSTALL_ABORTED',
    )
    assert.match(readFileSync(traceFile, 'utf8'), /signal:SIGTERM/u)
  })

  it(
    'waits for a SIGTERM-resistant installer descendant to be killed',
    { skip: process.platform === 'win32' },
    async () => {
      const { input, traceFile } = fixture('tree-hang')
      const controller = new AbortController()
      input.signal = controller.signal
      setTimeout(() => controller.abort(), 300)

      await assert.rejects(() => materializeNpmPackage(input))
      const descendant = Number(readFileSync(traceFile, 'utf8').match(/descendant:(\d+)/u)?.[1])
      assert.ok(descendant > 0)
      assert.throws(() => process.kill(descendant, 0))
    },
  )

  it('maps installer and entry failures without exposing stderr or private paths', async () => {
    for (const [mode, code] of [
      ['exit-error', 'ACP_INSTALL_FAILED'],
      ['missing-bin', 'ACP_INSTALL_ENTRY_INVALID'],
      ['multiple-bin', 'ACP_INSTALL_ENTRY_INVALID'],
      ['escaping-bin', 'ACP_INSTALL_ENTRY_INVALID'],
      ['mismatched-version', 'ACP_INSTALL_ENTRY_INVALID'],
    ] as const) {
      const { input, stagingDir } = fixture(mode)
      await assert.rejects(
        () => materializeNpmPackage(input),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, code)
          assert.equal(String(error).includes(stagingDir), false)
          assert.equal(String(error).includes('fixture-secret'), false)
          return true
        },
      )
    }
  })

  it('rejects npm tags and ranges instead of resolving a mutable package version', async () => {
    const { input } = fixture()
    input.packageSpec = '@example/agent@latest'
    await assert.rejects(
      () => materializeNpmPackage(input),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & { code?: string }).code === 'ACP_INSTALL_ENTRY_INVALID',
    )
  })

  it('rejects URL-like package names even when they end with an exact version', async () => {
    const { input } = fixture()
    input.packageSpec = 'https://example.com/agent.tgz@1.2.3'
    await assert.rejects(
      () => materializeNpmPackage(input),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & { code?: string }).code === 'ACP_INSTALL_ENTRY_INVALID',
    )
  })
})
