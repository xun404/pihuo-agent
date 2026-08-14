import { lstatSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { PermissionTargetScope } from '@pihuo-agent/shared'

export interface AcpFilePathClassification {
  scope: PermissionTargetScope
  resolvedPath?: string
  projectRoot?: string
}

export interface ClassifyAcpFilePathInput {
  projectRoot: string
  path: string
}

export interface ClassifyAcpLocationsInput {
  projectRoot: string
  locations?: Array<{ path: string }>
}

function hasPathEntry(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function canonicalTarget(path: string): string | undefined {
  if (hasPathEntry(path)) {
    try {
      return realpathSync(path)
    } catch {
      return undefined
    }
  }

  const suffix: string[] = []
  let ancestor = path
  while (!hasPathEntry(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) return undefined
    suffix.unshift(basename(ancestor))
    ancestor = parent
  }

  try {
    return resolve(realpathSync(ancestor), ...suffix)
  } catch {
    return undefined
  }
}

function isWithinProject(projectRoot: string, target: string): boolean {
  const rel = relative(projectRoot, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function classifyAcpFilePath(input: ClassifyAcpFilePathInput): AcpFilePathClassification {
  if (
    typeof input.projectRoot !== 'string' ||
    !input.projectRoot.trim() ||
    input.projectRoot.includes('\0') ||
    typeof input.path !== 'string' ||
    !input.path.trim() ||
    input.path.includes('\0')
  ) {
    return { scope: 'unknown' }
  }

  let projectRoot: string
  try {
    projectRoot = realpathSync(input.projectRoot)
    if (!statSync(projectRoot).isDirectory()) return { scope: 'unknown' }
  } catch {
    return { scope: 'unknown' }
  }

  const candidate = isAbsolute(input.path) ? resolve(input.path) : resolve(projectRoot, input.path)
  const resolvedPath = canonicalTarget(candidate)
  if (!resolvedPath) return { scope: 'unknown', projectRoot }

  return {
    scope: isWithinProject(projectRoot, resolvedPath) ? 'inside_project' : 'outside_project',
    resolvedPath,
    projectRoot,
  }
}

export function classifyAcpLocations(input: ClassifyAcpLocationsInput): PermissionTargetScope {
  if (!Array.isArray(input.locations) || input.locations.length === 0) return 'unknown'

  let hasOutside = false
  for (const location of input.locations) {
    const classification = classifyAcpFilePath({
      projectRoot: input.projectRoot,
      path: location?.path,
    })
    if (classification.scope === 'unknown') return 'unknown'
    if (classification.scope === 'outside_project') hasOutside = true
  }
  return hasOutside ? 'outside_project' : 'inside_project'
}
