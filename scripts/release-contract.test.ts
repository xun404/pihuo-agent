import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  verifyPackageVersions,
  verifyReleaseAssets,
  verifyReleaseTag,
  verifyRuntimeManifestContract,
} from './release-contract.mjs'

// Enabled package matrix: mac arm64 + linux x64 (Windows matrix currently disabled).
// Names match electron-builder ${arch} mapping: AppImage x86_64, deb amd64.
const requiredAssets = [
  'PiHuo-0.1.0-mac-arm64.dmg',
  'PiHuo-0.1.0-mac-arm64.zip',
  'PiHuo-0.1.0-linux-x86_64.AppImage',
  'PiHuo-0.1.0-linux-amd64.deb',
]
const completeAssets = [...requiredAssets, 'PiHuo-0.1.0-win-x64.exe']
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('desktop release contract', () => {
  it('requires a v-prefixed tag matching the package version', () => {
    assert.doesNotThrow(() => verifyReleaseTag('v0.1.0', '0.1.0'))
    assert.throws(() => verifyReleaseTag('v0.1.1', '0.1.0'), /does not match package version/)
    assert.throws(() => verifyReleaseTag('0.1.0', '0.1.0'), /does not match package version/)
  })

  it('requires root and desktop package versions to stay aligned', () => {
    assert.doesNotThrow(() => verifyPackageVersions('0.1.0', '0.1.0'))
    assert.throws(() => verifyPackageVersions('0.1.0', '0.2.0'), /Desktop package version/)
  })

  it('accepts the enabled package matrix without Windows', () => {
    assert.deepEqual(verifyReleaseAssets(requiredAssets), {
      macDmg: true,
      macZip: true,
      windowsNsis: false,
      linuxAppImage: true,
      linuxDeb: true,
    })
  })

  it('accepts Windows when present and accepts alternate linux arch tokens', () => {
    assert.deepEqual(verifyReleaseAssets(completeAssets), {
      macDmg: true,
      macZip: true,
      windowsNsis: true,
      linuxAppImage: true,
      linuxDeb: true,
    })
    assert.doesNotThrow(() =>
      verifyReleaseAssets([
        'PiHuo-0.1.0-mac-arm64.dmg',
        'PiHuo-0.1.0-mac-arm64.zip',
        'PiHuo-0.1.0-linux-x64.AppImage',
        'PiHuo-0.1.0-linux-x64.deb',
      ]),
    )
  })

  it('ignores update metadata while checking primary installers', () => {
    assert.doesNotThrow(() =>
      verifyReleaseAssets([
        ...completeAssets,
        'latest-mac.yml',
        'latest.yml',
        'latest-linux.yml',
        'PiHuo-0.1.0-mac-arm64.zip.blockmap',
      ]),
    )
  })

  it('rejects missing, duplicate, or unexpected architecture assets', () => {
    assert.throws(
      () => verifyReleaseAssets(requiredAssets.slice(1)),
      /Missing release asset: macDmg/,
    )
    assert.throws(
      () => verifyReleaseAssets([...requiredAssets, requiredAssets[0]!]),
      /Duplicate release asset: macDmg/,
    )
    assert.throws(
      () => verifyReleaseAssets([...requiredAssets, 'PiHuo-0.1.0-mac-x64.dmg']),
      /Unexpected primary release asset/,
    )
  })

  it('requires node-pty 1.1.0 to be external and staged in the native runtime', () => {
    const manifest = {
      nativePackages: {
        pty: 'node-pty',
      },
      ptyVersion: '1.1.0',
      leaderSdkVersion: '1.3.0',
      bundledRegistryVerifier: 'verify-bundled-registry.mjs',
      bundledRegistry: {
        schemaVersion: '1.0.0',
        schemaMajor: 1,
        digest: `sha256:${'a'.repeat(64)}`,
        agentCount: 38,
      },
      bundledRegistryExternalImports: ['node:crypto'],
      stagedPackages: ['node-pty', '@earendil-works/pi-coding-agent'],
      externalImports: ['node-pty', '@earendil-works/pi-coding-agent'],
    }
    assert.doesNotThrow(() => verifyRuntimeManifestContract(manifest))
    assert.throws(
      () =>
        verifyRuntimeManifestContract({
          ...manifest,
          externalImports: ['@earendil-works/pi-coding-agent'],
        }),
      /node-pty.*external/i,
    )
    assert.throws(
      () => verifyRuntimeManifestContract({ ...manifest, ptyVersion: '1.0.0' }),
      /1\.1\.0/,
    )
    assert.throws(
      () =>
        verifyRuntimeManifestContract({
          ...manifest,
          bundledRegistryVerifier: '../packages/adapters/src/acp-registry-bundled.ts',
        }),
      /bundled Registry verifier/i,
    )
    assert.throws(
      () =>
        verifyRuntimeManifestContract({
          ...manifest,
          bundledRegistryExternalImports: ['@pihuo-agent/adapters'],
        }),
      /source imports/i,
    )
  })

  it('pins the electron-builder downloader API required by native packaging', () => {
    const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))

    // npm is the sole package manager; keep @electron/get on the API electron-builder expects.
    assert.equal(rootPackage.overrides?.['@electron/get'], '5.1.0')
  })

  it('regenerates the complete ACP Registry snapshot before packaging', () => {
    const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
    const prepare = String(rootPackage.scripts?.['package:prepare'] ?? '')

    assert.match(
      prepare,
      /^npm run sync:model-registry && npm run sync:acp-registry && npm run build/u,
    )
  })
})
