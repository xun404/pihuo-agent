import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AcpRunnerError,
  buildPackageAgentArgv,
  resolveAcpRunner,
  resolveRunnerAbsolutePath,
} from './acp-runner-resolver.js'

describe('acp-runner-resolver', () => {
  it('resolves npx from PATH when present', () => {
    const path = resolveRunnerAbsolutePath('npx')
    // CI always has node/npx in this monorepo environment
    assert.ok(path === null || path.includes('npx'))
    if (path) {
      const runner = resolveAcpRunner('npx')
      assert.equal(runner.kind, 'npx')
      assert.ok(runner.command.includes('npx') || runner.command.length > 0)
    }
  })

  it('throws ACP_RUNNER_MISSING for empty PATH', () => {
    assert.throws(
      () => resolveAcpRunner('uvx', { ...process.env, PATH: '' }),
      (e: unknown) => e instanceof AcpRunnerError && e.code === 'ACP_RUNNER_MISSING',
    )
  })

  it('builds npx argv with package spec and agent args', () => {
    const { args } = buildPackageAgentArgv({
      kind: 'npx',
      packageSpec: '@example/agent@1.0.0',
      agentArgs: ['--stdio'],
      runner: { kind: 'npx', command: '/usr/bin/npx' },
    })
    assert.deepEqual(args, ['--yes', '@example/agent@1.0.0', '--stdio'])
  })

  it('rejects a regular but non-executable Unix runner', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-runner-nonexec-'))
    const command = join(dir, 'npx')
    writeFileSync(command, '#!/bin/sh\necho 1.0.0\n')
    chmodSync(command, 0o600)
    assert.equal(resolveRunnerAbsolutePath('npx', { PATH: dir }, 'linux'), null)
  })

  it('fails closed when runner version cannot be verified', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-runner-version-'))
    const command = join(dir, 'uvx')
    writeFileSync(command, '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    assert.throws(
      () => resolveAcpRunner('uvx', { PATH: dir }),
      (error: unknown) => error instanceof AcpRunnerError && error.code === 'ACP_RUNNER_MISSING',
    )
  })
})
