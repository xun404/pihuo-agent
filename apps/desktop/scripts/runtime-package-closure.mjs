import { createRequire } from 'node:module'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

async function locatePackage(name, fromFile) {
  const lookup = createRequire(fromFile).resolve.paths(name) ?? []
  for (const directory of lookup) {
    const root = join(directory, ...name.split('/'))
    try {
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
      if (manifest.name === name) return { root, manifest }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
  }
  return undefined
}

/** Copy production dependencies with their installed npm layout and package assets. */
export async function stagePackageClosure({ names, sourceNodeModules, outputNodeModules }) {
  const copied = new Set()
  const packageNames = new Set()
  async function visit(name, fromFile, optional = false) {
    const found = await locatePackage(name, fromFile)
    if (!found) {
      if (optional) return
      throw new Error(`Cannot stage required runtime package: ${name}`)
    }
    const { root, manifest } = found
    if (copied.has(root)) return
    const path = relative(sourceNodeModules, root)
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
      throw new Error(`Runtime package resolves outside the installed dependency tree: ${name}`)
    }
    copied.add(root)
    packageNames.add(name)
    const destination = resolve(outputNodeModules, path)
    await mkdir(dirname(destination), { recursive: true })
    await cp(root, destination, {
      recursive: true,
      dereference: true,
      filter: (file) => !relative(root, file).split(sep).includes('node_modules'),
    })
    const optionalDependencies = manifest.optionalDependencies ?? {}
    for (const dependency of Object.keys({
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...optionalDependencies,
    })) {
      await visit(
        dependency,
        join(root, 'package.json'),
        dependency in optionalDependencies ||
          manifest.peerDependenciesMeta?.[dependency]?.optional === true,
      )
    }
  }
  const entry = join(dirname(sourceNodeModules), 'package.json')
  for (const name of names) await visit(name, entry)
  return [...packageNames].sort()
}
