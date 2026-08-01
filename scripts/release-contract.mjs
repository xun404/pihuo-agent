// Required for the currently enabled package matrix (mac arm64 + linux x64).
// electron-builder maps ${arch} differently per target: AppImage → x86_64, deb → amd64.
const REQUIRED_ASSET_PATTERNS = {
  macDmg: /^SwarmDesk-Agent-.+-mac-arm64\.dmg$/,
  macZip: /^SwarmDesk-Agent-.+-mac-arm64\.zip$/,
  linuxAppImage: /^SwarmDesk-Agent-.+-linux-(?:x64|x86_64)\.AppImage$/,
  linuxDeb: /^SwarmDesk-Agent-.+-linux-(?:x64|amd64)\.deb$/,
}

// Optional while the Windows package matrix entry is disabled (GHA smoke hang).
const OPTIONAL_ASSET_PATTERNS = {
  windowsNsis: /^SwarmDesk-Agent-.+-win-x64\.exe$/,
}

const PRIMARY_ASSET_PATTERNS = {
  ...REQUIRED_ASSET_PATTERNS,
  ...OPTIONAL_ASSET_PATTERNS,
}

const PRIMARY_EXTENSION = /\.(?:dmg|zip|exe|AppImage|deb)$/

export function verifyReleaseTag(tag, version) {
  const expected = `v${version}`
  if (tag !== expected) {
    throw new Error(`Release tag ${tag || '<empty>'} does not match package version ${expected}`)
  }
}

export function verifyPackageVersions(rootVersion, desktopVersion) {
  if (rootVersion !== desktopVersion) {
    throw new Error(`Desktop package version ${desktopVersion} does not match root ${rootVersion}`)
  }
}

export function verifyRuntimeManifestContract(manifest) {
  if (manifest?.nativePackages?.pty !== 'node-pty') {
    throw new Error('Runtime manifest must identify node-pty as a native package')
  }
  if (manifest?.ptyVersion !== '1.1.0') {
    throw new Error('Runtime manifest must pin node-pty 1.1.0')
  }
  if (!manifest?.stagedPackages?.includes?.('node-pty')) {
    throw new Error('Runtime manifest must stage node-pty')
  }
  if (!manifest?.externalImports?.includes?.('node-pty')) {
    throw new Error('Runtime manifest must keep node-pty external')
  }
  if (manifest?.bundledRegistryVerifier !== 'verify-bundled-registry.mjs') {
    throw new Error('Runtime manifest must include the bundled Registry verifier')
  }
  if (
    !manifest?.bundledRegistry ||
    manifest.bundledRegistry.schemaMajor !== 1 ||
    !Number.isInteger(manifest.bundledRegistry.agentCount) ||
    manifest.bundledRegistry.agentCount <= 0 ||
    typeof manifest.bundledRegistry.digest !== 'string'
  ) {
    throw new Error('Runtime manifest must include verified bundled Registry facts')
  }
  if (
    !Array.isArray(manifest?.bundledRegistryExternalImports) ||
    manifest.bundledRegistryExternalImports.some(
      (specifier) => typeof specifier !== 'string' || !specifier.startsWith('node:'),
    )
  ) {
    throw new Error('Bundled Registry verifier must not depend on source imports')
  }
}

export function verifyReleaseAssets(fileNames) {
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    throw new Error('Release asset list is empty')
  }

  const matches = Object.fromEntries(Object.keys(PRIMARY_ASSET_PATTERNS).map((key) => [key, []]))
  for (const fileName of fileNames) {
    const matched = Object.entries(PRIMARY_ASSET_PATTERNS).find(([, pattern]) =>
      pattern.test(fileName),
    )
    if (matched) {
      matches[matched[0]].push(fileName)
      continue
    }
    if (PRIMARY_EXTENSION.test(fileName) && !fileName.endsWith('.blockmap')) {
      throw new Error(`Unexpected primary release asset: ${fileName}`)
    }
  }

  for (const key of Object.keys(REQUIRED_ASSET_PATTERNS)) {
    const values = matches[key]
    if (values.length === 0) throw new Error(`Missing release asset: ${key}`)
    if (values.length > 1) throw new Error(`Duplicate release asset: ${key}`)
  }

  for (const key of Object.keys(OPTIONAL_ASSET_PATTERNS)) {
    const values = matches[key]
    if (values.length > 1) throw new Error(`Duplicate release asset: ${key}`)
  }

  return Object.fromEntries(
    Object.keys(PRIMARY_ASSET_PATTERNS).map((key) => [key, matches[key].length === 1]),
  )
}
