import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { validateCiWorkflow, validateReleaseWorkflow } from './workflow-contract.mjs'

const ci = parse(await readFile('.github/workflows/ci.yml', 'utf8'))
const release = parse(await readFile('.github/workflows/release.yml', 'utf8'))

validateCiWorkflow(ci)
validateReleaseWorkflow(release)
console.log('GitHub Actions workflow contracts verified')
