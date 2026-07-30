import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import * as adapters from './index.js'

const cleanup: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanup.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ACP path scope API', () => {
  it('exports the shared file and location classifiers', () => {
    assert.equal(typeof adapters.classifyAcpFilePath, 'function')
    assert.equal(typeof adapters.classifyAcpLocations, 'function')
  })

  it('classifies the root, relative children, and missing children as project-local', () => {
    const projectRoot = tempDir('acp-scope-root-')
    mkdirSync(join(projectRoot, 'src'))
    writeFileSync(join(projectRoot, 'src', 'index.ts'), 'ok')

    assert.equal(adapters.classifyAcpFilePath({ projectRoot, path: projectRoot }).scope, 'inside_project')
    assert.equal(
      adapters.classifyAcpFilePath({ projectRoot, path: 'src/index.ts' }).scope,
      'inside_project',
    )
    assert.equal(
      adapters.classifyAcpFilePath({ projectRoot, path: 'src/new/deep.ts' }).scope,
      'inside_project',
    )
  })

  it('rejects parent traversal, absolute outsiders, and similar path prefixes', () => {
    const projectRoot = tempDir('acp-scope-prefix-')
    const outside = `${projectRoot}-other`
    mkdirSync(outside)
    cleanup.push(outside)

    assert.equal(
      adapters.classifyAcpFilePath({ projectRoot, path: '../outside.txt' }).scope,
      'outside_project',
    )
    assert.equal(
      adapters.classifyAcpFilePath({ projectRoot, path: join(outside, 'file.txt') }).scope,
      'outside_project',
    )
  })

  it('resolves file and parent-directory symlinks before classifying missing targets', () => {
    const projectRoot = tempDir('acp-scope-link-root-')
    const outside = tempDir('acp-scope-link-outside-')
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'secret')
    symlinkSync(secret, join(projectRoot, 'file-link'))
    symlinkSync(outside, join(projectRoot, 'dir-link'))

    assert.equal(
      adapters.classifyAcpFilePath({ projectRoot, path: 'file-link' }).scope,
      'outside_project',
    )
    assert.equal(
      adapters.classifyAcpFilePath({ projectRoot, path: 'dir-link/new.txt' }).scope,
      'outside_project',
    )
  })

  it('fails closed for invalid paths and an invalid project root', () => {
    const projectRoot = tempDir('acp-scope-invalid-')
    assert.equal(adapters.classifyAcpFilePath({ projectRoot, path: '' }).scope, 'unknown')
    assert.equal(adapters.classifyAcpFilePath({ projectRoot, path: 'bad\0path' }).scope, 'unknown')
    assert.equal(
      adapters.classifyAcpFilePath({ projectRoot: join(projectRoot, 'missing'), path: 'a.txt' }).scope,
      'unknown',
    )
  })

  it('requires every location to be valid and project-local', () => {
    const projectRoot = tempDir('acp-scope-locations-')
    const outside = tempDir('acp-scope-location-outside-')
    mkdirSync(join(projectRoot, 'src'))

    assert.equal(adapters.classifyAcpLocations({ projectRoot, locations: [] }), 'unknown')
    assert.equal(
      adapters.classifyAcpLocations({
        projectRoot,
        locations: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
      }),
      'inside_project',
    )
    assert.equal(
      adapters.classifyAcpLocations({
        projectRoot,
        locations: [{ path: 'src/a.ts' }, { path: join(outside, 'b.ts') }],
      }),
      'outside_project',
    )
    assert.equal(
      adapters.classifyAcpLocations({
        projectRoot,
        locations: [{ path: 'src/a.ts' }, { path: '' }],
      }),
      'unknown',
    )
  })
})
