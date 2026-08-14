import path from 'node:path'

export interface DesktopRuntimeLayout {
  mode: 'development' | 'packaged'
  identityRoot: string
  rendererDist: string
  apiEntry: string
  apiCwd: string
}

export function resolveDesktopRuntimeLayout(input: {
  isPackaged: boolean
  moduleDir: string
  resourcesPath: string
  userDataPath: string
}): DesktopRuntimeLayout {
  if (input.isPackaged) {
    return {
      mode: 'packaged',
      identityRoot: path.resolve(input.userDataPath),
      rendererDist: path.resolve(input.moduleDir, '../dist'),
      apiEntry: path.resolve(input.resourcesPath, 'runtime/http-server.mjs'),
      apiCwd: path.resolve(input.resourcesPath, 'runtime'),
    }
  }

  const repoRoot = path.resolve(input.moduleDir, '../../..')
  return {
    mode: 'development',
    identityRoot: repoRoot,
    rendererDist: path.resolve(input.moduleDir, '../dist'),
    apiEntry: path.resolve(repoRoot, 'packages/pi-runtime/src/http-server.ts'),
    apiCwd: path.resolve(repoRoot, 'packages/pi-runtime'),
  }
}
