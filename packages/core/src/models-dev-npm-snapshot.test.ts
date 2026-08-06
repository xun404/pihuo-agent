import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  installAndApplyModelsDevNpmSnapshot,
  MODELS_DEV_NPM_PACKAGE,
  resolveNpmInvoke,
} from './models-dev-npm-snapshot.js'
import { modelsDevCatalogPaths, loadModelsDevRegistry, loadModelsDevMeta } from './models-dev-catalog.js'

describe('models-dev-npm-snapshot', () => {
  it('resolveNpmInvoke uses node for npm-cli.js paths', () => {
    const r = resolveNpmInvoke('/usr/lib/node_modules/npm/bin/npm-cli.js', '/bin/node')
    assert.equal(r.command, '/bin/node')
    assert.deepEqual(r.baseArgs, ['/usr/lib/node_modules/npm/bin/npm-cli.js'])
    const r2 = resolveNpmInvoke('npm')
    assert.equal(r2.command, 'npm')
    assert.deepEqual(r2.baseArgs, [])
  })

  it('installAndApplyModelsDevNpmSnapshot writes LKG from mocked npm install + snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sd-npm-snap-'))
    const paths = modelsDevCatalogPaths(root, join(root, 'cache'))
    const prefixDir = join(root, 'npm-prefix')

    const fakeProviders = {
      cool: {
        id: 'cool',
        name: 'Cool',
        env: ['COOL_KEY'],
        npm: '@ai-sdk/openai-compatible',
        api: 'https://cool.example/v1',
        doc: 'https://cool.example/docs',
        models: {
          'cool-1': {
            id: 'cool-1',
            name: 'Cool 1',
            description: 't',
            attachment: false,
            reasoning: false,
            tool_call: true,
            release_date: '2026-01-01',
            last_updated: '2026-01-01',
            modalities: { input: ['text'], output: ['text'] },
            open_weights: false,
            limit: { context: 8192, output: 1024 },
          },
        },
      },
    }

    const execFileImpl = async (
      _cmd: string,
      args: readonly string[] | string[],
      _opts?: unknown,
    ) => {
      // npm install @opencode-ai/models@latest ...
      assert.ok(Array.from(args).some((a) => String(a).includes(MODELS_DEV_NPM_PACKAGE)))
      const pkgRoot = join(prefixDir, 'node_modules', '@opencode-ai', 'models')
      mkdirSync(join(pkgRoot, 'dist'), { recursive: true })
      writeFileSync(
        join(pkgRoot, 'package.json'),
        JSON.stringify({ name: MODELS_DEV_NPM_PACKAGE, version: '9.9.9' }),
        'utf8',
      )
      // ESM snapshot module
      writeFileSync(
        join(pkgRoot, 'dist', 'snapshot.js'),
        `export const providers = ${JSON.stringify(fakeProviders)};
export const generatedAt = "2026-08-05T00:00:00.000Z";
export default { providers, models: {}, generatedAt };
`,
        'utf8',
      )
      return { stdout: 'ok', stderr: '' }
    }

    const result = await installAndApplyModelsDevNpmSnapshot({
      paths,
      prefixDir,
      registry: 'https://registry.npmmirror.com',
      execFileImpl: execFileImpl as never,
    })

    assert.equal(result.via, 'npm-snapshot')
    assert.equal(result.packageVersion, '9.9.9')
    assert.equal(result.providerCount, 1)
    assert.equal(result.generatedAt, '2026-08-05T00:00:00.000Z')
    assert.match(result.meta.sourceUrl, /npm:@opencode-ai\/models@9\.9\.9\/snapshot/)
    assert.ok(existsSync(paths.apiJsonPath))
    const reg = loadModelsDevRegistry(paths)
    assert.ok(reg?.cool)
    assert.equal(reg?.cool?.name, 'Cool')
    const meta = loadModelsDevMeta(paths)
    assert.equal(meta?.providerCount, 1)
  })
})
