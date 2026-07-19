import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyReleaseAssets } from './release-contract.mjs'

const assetDirectory = resolve(process.argv[2] || 'release-assets')
const entries = await readdir(assetDirectory, { withFileTypes: true })
const fileNames = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort()

verifyReleaseAssets(fileNames)
console.log(`Release assets verified in ${assetDirectory}`)
