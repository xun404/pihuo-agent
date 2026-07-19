import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyPackageVersions, verifyReleaseTag } from './release-contract.mjs'

const rootPackage = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const desktopPackage = JSON.parse(await readFile(resolve('apps/desktop/package.json'), 'utf8'))
const tag = process.env.RELEASE_TAG || process.argv[2] || ''

verifyPackageVersions(rootPackage.version, desktopPackage.version)
verifyReleaseTag(tag, rootPackage.version)
console.log(`Release tag verified: ${tag}`)
