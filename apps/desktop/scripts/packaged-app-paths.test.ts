import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import YAML from 'yaml'
import { resolvePackagedExecutable, resolvePackagedRuntimeDir } from './packaged-app-paths.mjs'

describe('packaged desktop executable paths', () => {
  it('resolves the macOS arm64 app executable', () => {
    assert.equal(
      resolvePackagedExecutable({
        platform: 'darwin',
        releaseDir: '/repo/release',
        productName: 'PiHuo',
      }),
      '/repo/release/mac-arm64/PiHuo.app/Contents/MacOS/PiHuo',
    )
  })

  it('resolves the Windows x64 unpacked executable', () => {
    assert.equal(
      resolvePackagedExecutable({
        platform: 'win32',
        releaseDir: String.raw`C:\repo\release`,
        productName: 'PiHuo',
      }),
      String.raw`C:\repo\release\win-unpacked\PiHuo.exe`,
    )
  })

  it('resolves the Linux x64 unpacked executable', () => {
    assert.equal(
      resolvePackagedExecutable({
        platform: 'linux',
        releaseDir: '/repo/release',
        productName: 'PiHuo',
      }),
      '/repo/release/linux-unpacked/pihuo',
    )
  })

  it('resolves the packaged runtime directory on every release platform', () => {
    assert.equal(
      resolvePackagedRuntimeDir({
        platform: 'darwin',
        releaseDir: '/repo/release',
        productName: 'PiHuo',
      }),
      '/repo/release/mac-arm64/PiHuo.app/Contents/Resources/runtime',
    )
    assert.equal(
      resolvePackagedRuntimeDir({
        platform: 'win32',
        releaseDir: String.raw`C:\repo\release`,
        productName: 'PiHuo',
      }),
      String.raw`C:\repo\release\win-unpacked\resources\runtime`,
    )
    assert.equal(
      resolvePackagedRuntimeDir({
        platform: 'linux',
        releaseDir: '/repo/release',
        productName: 'PiHuo',
      }),
      '/repo/release/linux-unpacked/resources/runtime',
    )
  })

  it('rejects unsupported host platforms', () => {
    assert.throws(
      () =>
        resolvePackagedExecutable({
          platform: 'freebsd',
          releaseDir: '/repo/release',
          productName: 'PiHuo',
        }),
      /Unsupported packaged smoke platform/,
    )
  })

  it('declares the packaged Electron main entry as ESM', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    )
    assert.equal(packageJson.type, 'module')
  })

  it('copies staged runtime node_modules through electron-builder filtering', async () => {
    const config = YAML.parse(
      await readFile(new URL('../../../electron-builder.yml', import.meta.url), 'utf8'),
    )

    assert.ok(
      config.extraResources.some(
        (entry: { from?: string; to?: string }) =>
          entry.from === 'apps/desktop/dist-runtime/node_modules' &&
          entry.to === 'runtime/node_modules',
      ),
    )
  })
})
