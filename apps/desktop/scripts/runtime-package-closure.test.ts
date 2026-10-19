import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { stagePackageClosure } from './runtime-package-closure.mjs'

async function writePackage(root: string, manifest: object) {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
}

describe('runtime package closure', () => {
  it('preserves package resources and nested versions without staging development dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pihuo-runtime-closure-'))
    try {
      const modules = join(root, 'node_modules')
      const output = join(root, 'staged', 'node_modules')
      await writePackage(root, { name: 'fixture' })
      await writePackage(join(modules, 'sdk'), {
        name: 'sdk',
        dependencies: { shared: '1', helper: '1' },
        optionalDependencies: { 'unavailable-platform': '1' },
        devDependencies: { 'dev-only': '1' },
      })
      await writeFile(join(modules, 'sdk', 'worker.wasm'), 'wasm resource')
      await writePackage(join(modules, 'shared'), { name: 'shared', version: '1.0.0' })
      await writePackage(join(modules, 'helper'), { name: 'helper', dependencies: { shared: '2' } })
      await writePackage(join(modules, 'helper', 'node_modules', 'shared'), {
        name: 'shared',
        version: '2.0.0',
      })
      const staged = await stagePackageClosure({
        names: ['sdk'],
        sourceNodeModules: modules,
        outputNodeModules: output,
      })
      assert.deepEqual(staged, ['helper', 'sdk', 'shared'])
      assert.equal(await readFile(join(output, 'sdk', 'worker.wasm'), 'utf8'), 'wasm resource')
      assert.equal(
        JSON.parse(await readFile(join(output, 'shared', 'package.json'), 'utf8')).version,
        '1.0.0',
      )
      assert.equal(
        JSON.parse(
          await readFile(join(output, 'helper', 'node_modules', 'shared', 'package.json'), 'utf8'),
        ).version,
        '2.0.0',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails when a required production dependency is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pihuo-runtime-missing-'))
    try {
      await writePackage(root, { name: 'fixture' })
      await writePackage(join(root, 'node_modules', 'sdk'), {
        name: 'sdk',
        dependencies: { 'missing-fixture-package': '1' },
      })
      await assert.rejects(
        stagePackageClosure({
          names: ['sdk'],
          sourceNodeModules: join(root, 'node_modules'),
          outputNodeModules: join(root, 'staged'),
        }),
        /Cannot stage required runtime package: missing-fixture-package/,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
