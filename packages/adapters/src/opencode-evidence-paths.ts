import { join } from 'node:path'

export interface OpenCodeEvidencePaths {
  home: string
  xdgDataHome?: string
  xdgConfigHome?: string
  /** Paths actually consulted (for revision hashing and execution projection). */
  authPaths: string[]
  disabledPaths: string[]
}

/** Resolve OpenCode auth/config roots without falling back across an explicit XDG boundary. */
export function resolveOpenCodeEvidencePaths(opts: {
  HOME?: string
  XDG_DATA_HOME?: string
  XDG_CONFIG_HOME?: string
  realHome?: string
  explicitXdgData?: boolean
  explicitXdgConfig?: boolean
}): OpenCodeEvidencePaths {
  const home = opts.realHome ?? opts.HOME ?? process.env.HOME ?? ''
  const xdgDataProvided = opts.explicitXdgData === true || opts.XDG_DATA_HOME !== undefined
  const xdgConfigProvided = opts.explicitXdgConfig === true || opts.XDG_CONFIG_HOME !== undefined
  const xdgDataHome = opts.XDG_DATA_HOME?.trim() || undefined
  const xdgConfigHome = opts.XDG_CONFIG_HOME?.trim() || undefined

  const authPaths: string[] = []
  if (xdgDataProvided) {
    if (xdgDataHome) authPaths.push(join(xdgDataHome, 'opencode/auth.json'))
  } else if (home) {
    authPaths.push(join(home, '.local/share/opencode/auth.json'))
  }

  const disabledPaths: string[] = []
  if (xdgConfigProvided) {
    if (xdgConfigHome) disabledPaths.push(join(xdgConfigHome, 'opencode/opencode.json'))
  } else if (home) {
    disabledPaths.push(join(home, '.config/opencode/opencode.json'))
  }

  return { home, xdgDataHome, xdgConfigHome, authPaths, disabledPaths }
}
