import path from 'node:path'

export function isPackagedSmoke(argv: readonly string[]): boolean {
  return argv.includes('--packaged-smoke')
}

export function resolvePackagedSmokeUserDataPath(input: {
  packagedSmoke: boolean
  temporaryDirectory: string
  pid: number
}): string | undefined {
  if (!input.packagedSmoke) return undefined
  return path.resolve(input.temporaryDirectory, `swarmdesk-agent-packaged-smoke-${input.pid}`)
}

export function shouldCreateDesktopWindow(input: { packagedSmoke: boolean }): boolean {
  return !input.packagedSmoke
}

export async function runPackagedSmoke(input: {
  startApi(): Promise<boolean>
  stopApi(): Promise<boolean>
  log(message: string): void
}): Promise<number> {
  if (!(await input.startApi())) return 1
  input.log('Packaged API ready')
  if (!(await input.stopApi())) return 1
  input.log('Packaged API stopped')
  return 0
}
