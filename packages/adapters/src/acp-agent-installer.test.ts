import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { AcpRegistryAgentMetadata } from '@swarmdesk-agent/shared'
import { AcpInstallError, prepareRegistryAgent } from './acp-agent-installer.js'
import { digestOfAgentEntry } from './acp-registry-schema.js'

const FAKE_NPM = fileURLToPath(new URL('./fixtures/fake-npm-installer.ts', import.meta.url))
const TSX_LOADER = fileURLToPath(import.meta.resolve('tsx'))
const FAKE_PACKAGE_INSTALLER = {
  command: process.execPath,
  argsPrefix: ['--import', TSX_LOADER, FAKE_NPM],
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

describe('acp-agent-installer', () => {
  let dir: string

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-installer-'))
  })

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('requires trust for binary without declared sha256', async () => {
    const rawAgent = {
      id: 'no-sha-agent',
      name: 'No SHA',
      version: '1.0.0',
      description: 'd',
      distribution: {
        binary: {
          'darwin-aarch64': {
            archive: 'https://example.com/a.zip',
            cmd: './agent',
          },
        },
      },
    }
    const agent: AcpRegistryAgentMetadata = {
      id: 'no-sha-agent',
      name: 'No SHA',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/a.zip',
              cmd: './agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: digestOfAgentEntry(rawAgent),
      availability: 'available',
    }
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent,
          distribution: 'binary',
          target: 'darwin-aarch64',
          agentsRoot: join(dir, 'agents'),
        }),
      (e: unknown) => e instanceof AcpInstallError && e.code === 'ACP_INSTALL_TRUST_REQUIRED',
    )
  })

  it('installs a local raw binary at its declared executable path', async () => {
    const binaryPath = join(dir, 'agent-raw')
    writeFileSync(binaryPath, '#!/bin/sh\necho ok\n', { mode: 0o755 })
    const digest = sha256(readFileSync(binaryPath))
    const rawAgent = {
      id: 'zip-agent',
      name: 'Zip Agent',
      version: '1.0.0',
      description: 'd',
      distribution: {
        binary: {
          'darwin-aarch64': {
            archive: 'https://example.com/agent.bin',
            sha256: digest,
            cmd: './nested/agent',
            args: ['acp'],
          },
        },
      },
    }
    const agent: AcpRegistryAgentMetadata = {
      id: 'zip-agent',
      name: 'Zip Agent',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/agent.bin',
              sha256: digest,
              cmd: './nested/agent',
              args: ['acp'],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: digestOfAgentEntry(rawAgent),
      availability: 'available',
    }
    const result = await prepareRegistryAgent({
      agent,
      distribution: 'binary',
      target: 'darwin-aarch64',
      agentsRoot: join(dir, 'agents'),
      localArchivePath: binaryPath,
    })
    assert.equal(result.distribution, 'binary')
    assert.equal(result.observedSha256, digest)
    assert.ok(existsSync(result.resolvedExecutable!))
    assert.ok(result.resolvedExecutable!.endsWith(join('nested', 'agent')))
    assert.ok(result.installDir.includes('zip-agent'))

    const sentinel = join(result.installDir, 'sentinel')
    writeFileSync(sentinel, 'preserve')
    let fetchCalls = 0
    const reused = await prepareRegistryAgent({
      agent,
      distribution: 'binary',
      target: 'darwin-aarch64',
      agentsRoot: join(dir, 'agents'),
      fetchImpl: (async () => {
        fetchCalls += 1
        throw new Error('must not download an existing immutable installation')
      }) as typeof fetch,
    })
    assert.equal(fetchCalls, 0)
    assert.equal(reused.resolvedExecutable, result.resolvedExecutable)
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve')
  })

  it('reuses an existing prepared package without mutating its bytes', async () => {
    const agent: AcpRegistryAgentMetadata = {
      id: 'immutable-package',
      name: 'Immutable package',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'npx',
          package: '@example/immutable@1.0.0',
          args: ['--acp'],
          env: { ACP_MODE: 'stdio' },
        },
      ],
      manifestDigest: 'sha256:same-manifest',
      availability: 'available',
    }
    const first = await prepareRegistryAgent({
      agent,
      distribution: 'npx',
      target: 'darwin-aarch64',
      agentsRoot: join(dir, 'immutable-agents'),
      packageInstaller: FAKE_PACKAGE_INSTALLER,
    })
    const sentinel = join(first.installDir, 'sentinel')
    writeFileSync(sentinel, 'preserve-me')

    const previousPath = process.env.PATH
    process.env.PATH = ''
    const second = await prepareRegistryAgent({
      agent,
      distribution: 'npx',
      target: 'darwin-aarch64',
      agentsRoot: join(dir, 'immutable-agents'),
    }).finally(() => {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    })
    assert.equal(second.installDir, first.installDir)
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve-me')
  })

  it('materializes an npx package during prepare and launches its managed local bin', async () => {
    const agent: AcpRegistryAgentMetadata = {
      id: 'materialized-package',
      name: 'Materialized package',
      version: '1.2.3',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'npx',
          package: '@example/agent@1.2.3',
          args: ['--acp'],
          env: { ACP_MODE: 'stdio' },
        },
      ],
      manifestDigest: 'sha256:materialized-package',
      availability: 'available',
    }

    const traceFile = join(dir, 'materialized-install-env.trace')
    const result = await prepareRegistryAgent({
      agent,
      distribution: 'npx',
      target: 'darwin-aarch64',
      agentsRoot: join(dir, 'materialized-agents'),
      packageInstaller: FAKE_PACKAGE_INSTALLER,
      runnerEnv: {
        ...process.env,
        SWARMDESK_AGENT_INTERNAL_TOKEN: 'owner-secret-must-not-reach-npm',
        ACP_FAKE_NPM_TRACE_FILE: traceFile,
      },
    })

    assert.ok(result.resolvedExecutable?.startsWith(`${result.installDir}${sep}`))
    assert.equal(result.command, result.launchSpec.interpreter)
    assert.deepEqual(result.args, [result.resolvedExecutable, '--acp'])
    assert.equal(result.launchSpec.executable, result.resolvedExecutable)
    assert.equal(result.launchSpec.packageSpec, '@example/agent@1.2.3')
    assert.match(readFileSync(traceFile, 'utf8'), /owner-secret:absent/u)
  })

  it('launches a materialized native npm bin directly', async () => {
    const agent: AcpRegistryAgentMetadata = {
      id: 'materialized-native-package',
      name: 'Materialized native package',
      version: '1.2.3',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'npx',
          package: '@example/agent@1.2.3',
          args: ['--acp'],
          env: {},
        },
      ],
      manifestDigest: 'sha256:materialized-native-package',
      availability: 'available',
    }
    const result = await prepareRegistryAgent({
      agent,
      distribution: 'npx',
      target: 'darwin-aarch64',
      agentsRoot: join(dir, 'materialized-native-agents'),
      packageInstaller: FAKE_PACKAGE_INSTALLER,
      runnerEnv: { ...process.env, ACP_FAKE_NPM_MODE: 'native-bin' },
    })

    assert.equal(result.launchSpec.interpreter, undefined)
    assert.equal(result.command, result.resolvedExecutable)
    assert.deepEqual(result.args, ['--acp'])
  })

  it('rejects a conflicting manifest without changing an existing installation', async () => {
    const agentsRoot = join(dir, 'conflict-agents')
    const baseAgent: AcpRegistryAgentMetadata = {
      id: 'manifest-conflict',
      name: 'Manifest conflict',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'npx',
          package: '@example/one@1.0.0',
          args: [],
          env: {},
        },
      ],
      manifestDigest: 'sha256:first',
      availability: 'available',
    }
    const first = await prepareRegistryAgent({
      agent: baseAgent,
      distribution: 'npx',
      target: 'darwin-aarch64',
      agentsRoot,
      packageInstaller: FAKE_PACKAGE_INSTALLER,
    })
    const markerBefore = readFileSync(join(first.installDir, 'package-prepare.json'), 'utf8')
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent: {
            ...baseAgent,
            distributions: [
              {
                kind: 'npx',
                package: '@example/two@1.0.0',
                args: [],
                env: {},
              },
            ],
            manifestDigest: 'sha256:second',
          },
          distribution: 'npx',
          target: 'darwin-aarch64',
          agentsRoot,
        }),
      (error: unknown) =>
        error instanceof AcpInstallError &&
        error.code === 'ACP_INSTALL_DIGEST_MISMATCH' &&
        !error.message.includes(agentsRoot),
    )
    assert.equal(readFileSync(join(first.installDir, 'package-prepare.json'), 'utf8'), markerBefore)
  })

  it('rejects sha256 mismatch', async () => {
    const zipPath = join(dir, 'bad.zip')
    writeFileSync(zipPath, Buffer.from('not-a-real-zip-but-hashed'))
    const agent: AcpRegistryAgentMetadata = {
      id: 'bad-sha',
      name: 'Bad',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/b.zip',
              sha256: 'aa'.repeat(32),
              cmd: './agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: 'sha256:meta',
      availability: 'available',
    }
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent,
          distribution: 'binary',
          target: 'darwin-aarch64',
          agentsRoot: join(dir, 'agents2'),
          localArchivePath: zipPath,
        }),
      (e: unknown) => e instanceof AcpInstallError && e.code === 'ACP_INSTALL_DIGEST_MISMATCH',
    )
  })

  it('rejects tampered formal bytes during idempotent reuse without downloading', async () => {
    const binaryPath = join(dir, 'tamper-source')
    writeFileSync(binaryPath, '#!/bin/sh\necho original\n', { mode: 0o755 })
    const digest = sha256(readFileSync(binaryPath))
    const agent: AcpRegistryAgentMetadata = {
      id: 'tamper-agent',
      name: 'Tamper Agent',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/agent.bin',
              sha256: digest,
              cmd: './agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: 'sha256:tamper-manifest',
      availability: 'available',
    }
    const agentsRoot = join(dir, 'tamper-agents')
    const first = await prepareRegistryAgent({
      agent,
      distribution: 'binary',
      target: 'darwin-aarch64',
      agentsRoot,
      localArchivePath: binaryPath,
    })
    writeFileSync(first.resolvedExecutable!, '#!/bin/sh\necho changed\n')
    let fetchCalls = 0
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent,
          distribution: 'binary',
          target: 'darwin-aarch64',
          agentsRoot,
          fetchImpl: (async () => {
            fetchCalls += 1
            throw new Error('must not fetch')
          }) as typeof fetch,
        }),
      (error: unknown) =>
        error instanceof AcpInstallError && error.code === 'ACP_INSTALL_DIGEST_MISMATCH',
    )
    assert.equal(fetchCalls, 0)
  })

  it('keeps a total timeout when a caller cancellation signal is supplied', async () => {
    const agent: AcpRegistryAgentMetadata = {
      id: 'timeout-agent',
      name: 'Timeout Agent',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/agent.bin',
              cmd: './agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: 'sha256:timeout-manifest',
      availability: 'available',
    }
    const caller = new AbortController()
    const agentsRoot = join(dir, 'timeout-agents')
    const neverFetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        ),
      )) as typeof fetch
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent,
          distribution: 'binary',
          target: 'darwin-aarch64',
          agentsRoot,
          trust: {
            acceptedAt: new Date().toISOString(),
            explicitNoSha: true,
            manifestDigest: agent.manifestDigest,
          },
          signal: caller.signal,
          downloadTimeoutMs: 30,
          downloadHeaderTimeoutMs: 15,
          fetchImpl: neverFetch,
        }),
      (error: unknown) =>
        error instanceof AcpInstallError &&
        error.code === 'ACP_INSTALL_DOWNLOAD_FAILED' &&
        error.message === 'Download timed out',
    )
    const parent = join(agentsRoot, 'timeout-agent', '1.0.0')
    assert.equal(
      existsSync(parent)
        ? readdirSync(parent).some(
            (name) => name.includes('.staging.') || name.endsWith('.download'),
          )
        : false,
      false,
    )
  })

  it('aborts a response body that stalls (no bytes) after the stall deadline', async () => {
    const agent: AcpRegistryAgentMetadata = {
      id: 'stall-agent',
      name: 'Stall Agent',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/agent.bin',
              cmd: './agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: 'sha256:stall-manifest',
      availability: 'available',
    }
    const agentsRoot = join(dir, 'stall-agents')
    // Streams one chunk then never enqueues again: a real mid-transfer stall. The stall
    // guard (not the header timer, not the total timer) must fire and classify the failure.
    const stalledFetch = (() => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0, 1, 2, 3]))
          // intentionally never close or enqueue further
        },
      })
      const res = new Response(stream, { status: 200, headers: { 'content-length': '1048576' } })
      return (() => Promise.resolve(res)) as unknown as typeof fetch
    })()
    const parent = join(agentsRoot, agent.id, agent.version)
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent,
          distribution: 'binary',
          target: 'darwin-aarch64',
          agentsRoot,
          trust: {
            acceptedAt: new Date().toISOString(),
            explicitNoSha: true,
            manifestDigest: agent.manifestDigest,
          },
          downloadStallTimeoutMs: 50,
          downloadHeaderTimeoutMs: 5000,
          downloadTimeoutMs: 10_000,
          fetchImpl: stalledFetch,
        }),
      (error: unknown) =>
        error instanceof AcpInstallError &&
        error.code === 'ACP_INSTALL_DOWNLOAD_FAILED' &&
        error.message === 'Download timed out',
    )
    assert.equal(
      existsSync(parent)
        ? readdirSync(parent).some(
            (name) => name.includes('.staging.') || name.endsWith('.download'),
          )
        : false,
      false,
      'staging/download artifacts must be cleaned up after a stall',
    )
  })

  it('completes a slow-but-steady stream instead of killing it on a wall-clock total', async () => {
    const binaryBytes = Buffer.from('#!/bin/sh\necho ok\n')
    const digest = sha256(binaryBytes)
    const rawAgent = {
      id: 'steady-agent',
      name: 'Steady Agent',
      version: '1.0.0',
      description: 'd',
      distribution: {
        binary: {
          'darwin-aarch64': {
            archive: 'https://example.com/agent.bin',
            sha256: digest,
            cmd: './agent',
          },
        },
      },
    }
    const agent: AcpRegistryAgentMetadata = {
      id: 'steady-agent',
      name: 'Steady Agent',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/agent.bin',
              sha256: digest,
              cmd: './agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: digestOfAgentEntry(rawAgent),
      availability: 'available',
    }
    const agentsRoot = join(dir, 'steady-agents')
    // Drip the bytes in 4 chunks, 15ms apart. Every chunk lands within the 50ms stall
    // window, so the stream is "making progress" and must NOT be aborted even though it
    // takes ~60ms total (longer than a naive fixed deadline would tolerate).
    const steadyFetch = (() => {
      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < binaryBytes.length; i += 6) {
            controller.enqueue(binaryBytes.subarray(i, i + 6))
            await new Promise((r) => setTimeout(r, 15))
          }
          controller.close()
        },
      })
      const res = new Response(stream, { status: 200 })
      return (() => Promise.resolve(res)) as unknown as typeof fetch
    })()
    const result = await prepareRegistryAgent({
      agent,
      distribution: 'binary',
      target: 'darwin-aarch64',
      agentsRoot,
      downloadStallTimeoutMs: 50,
      downloadHeaderTimeoutMs: 5000,
      downloadTimeoutMs: 10_000,
      fetchImpl: steadyFetch,
    })
    assert.equal(result.distribution, 'binary')
    assert.equal(result.observedSha256, digest)
    assert.ok(existsSync(result.resolvedExecutable!), 'executable must be materialized')
  })

  it('rejects downloaded content whose magic does not match the original URL pathname', async () => {
    const body = Buffer.from('#!/bin/sh\necho not-a-zip\n')
    const localArchivePath = join(dir, 'signed-download-body')
    writeFileSync(localArchivePath, body, { mode: 0o755 })
    const agent: AcpRegistryAgentMetadata = {
      id: 'url-kind-mismatch',
      name: 'URL kind mismatch',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/agent.zip?download=1',
              sha256: sha256(body),
              cmd: './agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: 'sha256:url-kind-mismatch',
      availability: 'available',
    }
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent,
          distribution: 'binary',
          target: 'darwin-aarch64',
          agentsRoot: join(dir, 'url-kind-agents'),
          localArchivePath,
        }),
      (error: unknown) =>
        error instanceof AcpInstallError && error.code === 'ACP_INSTALL_ARCHIVE_UNSAFE',
    )
  })

  it('rejects reuse when a payload parent directory is replaced by an escaping symlink', async () => {
    const body = Buffer.from('#!/bin/sh\necho safe\n')
    const source = join(dir, 'parent-link-source')
    writeFileSync(source, body, { mode: 0o755 })
    const agent: AcpRegistryAgentMetadata = {
      id: 'parent-link-agent',
      name: 'Parent link Agent',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/agent.bin',
              sha256: sha256(body),
              cmd: './bin/agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: 'sha256:parent-link',
      availability: 'available',
    }
    const agentsRoot = join(dir, 'parent-link-agents')
    const first = await prepareRegistryAgent({
      agent,
      distribution: 'binary',
      target: 'darwin-aarch64',
      agentsRoot,
      localArchivePath: source,
    })
    const outside = join(dir, 'outside-parent-link')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'agent'), body, { mode: 0o755 })
    rmSync(join(first.installDir, 'bin'), { recursive: true, force: true })
    symlinkSync(outside, join(first.installDir, 'bin'), 'dir')
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent,
          distribution: 'binary',
          target: 'darwin-aarch64',
          agentsRoot,
        }),
      (error: unknown) =>
        error instanceof AcpInstallError && error.code === 'ACP_INSTALL_DIGEST_MISMATCH',
    )
  })

  it('rejects reuse when a managed ancestor below agentsRoot is replaced by an escaping symlink', async () => {
    const body = Buffer.from('#!/bin/sh\necho safe\n')
    const source = join(dir, 'managed-ancestor-source')
    writeFileSync(source, body, { mode: 0o755 })
    const agent: AcpRegistryAgentMetadata = {
      id: 'managed-ancestor-agent',
      name: 'Managed ancestor Agent',
      version: '1.0.0',
      description: 'd',
      icon: '',
      distributions: [
        {
          kind: 'binary',
          targets: [
            {
              target: 'darwin-aarch64',
              archiveUrl: 'https://example.com/agent.bin',
              sha256: sha256(body),
              cmd: './agent',
              args: [],
              env: {},
            },
          ],
        },
      ],
      manifestDigest: 'sha256:managed-ancestor',
      availability: 'available',
    }
    const agentsRoot = join(dir, 'managed-ancestor-agents')
    const first = await prepareRegistryAgent({
      agent,
      distribution: 'binary',
      target: 'darwin-aarch64',
      agentsRoot,
      localArchivePath: source,
    })
    const registryDir = join(agentsRoot, agent.id)
    const outside = join(dir, 'outside-managed-ancestor')
    renameSync(registryDir, outside)
    symlinkSync(outside, registryDir, 'dir')

    let fetchCalls = 0
    await assert.rejects(
      () =>
        prepareRegistryAgent({
          agent,
          distribution: 'binary',
          target: 'darwin-aarch64',
          agentsRoot,
          fetchImpl: (async () => {
            fetchCalls += 1
            throw new Error('must not fetch')
          }) as typeof fetch,
        }),
      (error: unknown) =>
        error instanceof AcpInstallError && error.code === 'ACP_INSTALL_DIGEST_MISMATCH',
    )
    assert.equal(fetchCalls, 0)
    assert.equal(existsSync(first.resolvedExecutable!), true)
  })
})
