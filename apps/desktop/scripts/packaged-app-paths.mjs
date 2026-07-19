import path from 'node:path'

export function resolvePackagedExecutable(input) {
  if (input.platform === 'darwin') {
    return path.posix.resolve(
      input.releaseDir,
      'mac-arm64',
      `${input.productName}.app`,
      'Contents/MacOS',
      input.productName,
    )
  }
  if (input.platform === 'win32') {
    return path.win32.resolve(input.releaseDir, 'win-unpacked', `${input.productName}.exe`)
  }
  if (input.platform === 'linux') {
    return path.posix.resolve(input.releaseDir, 'linux-unpacked', 'router-agents')
  }
  throw new Error(`Unsupported packaged smoke platform: ${input.platform}`)
}

export function resolvePackagedRuntimeDir(input) {
  if (input.platform === 'darwin') {
    return path.posix.resolve(
      input.releaseDir,
      'mac-arm64',
      `${input.productName}.app`,
      'Contents/Resources/runtime',
    )
  }
  if (input.platform === 'win32') {
    return path.win32.resolve(input.releaseDir, 'win-unpacked', 'resources/runtime')
  }
  if (input.platform === 'linux') {
    return path.posix.resolve(input.releaseDir, 'linux-unpacked', 'resources/runtime')
  }
  throw new Error(`Unsupported packaged smoke platform: ${input.platform}`)
}
