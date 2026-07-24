/**
 * Prepare ACP Registry agents: npx/uvx package materialize + binary download/extract.
 * Does not run third-party initialize probes by default (caller may opt in later).
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  renameSync,
  chmodSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  lstatSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type {
  AcpRegistryAgentMetadata,
  AcpRegistryBinaryDistribution,
  AcpRegistryDistributionKind,
  AcpRegistryPackageDistribution,
  AcpRegistryTarget,
  WorkerLaunchSpec,
} from '@swarmdesk-agent/shared'
import {
  assertExecutableInsideStaging,
  detectArchiveKind,
  extractArchiveSafe,
  readArchiveMagic,
  sha256File,
  AcpArchiveError,
  ARCHIVE_LIMITS,
} from './acp-archive-reader.js'
import {
  binaryDistributionToLaunchSpec,
  packageDistributionToLaunchSpec,
} from './acp-launch-spec.js'
import {
  buildPackageAgentArgv,
  resolveAcpRunner,
  type ResolvedRunner,
} from './acp-runner-resolver.js'

export type PrepareTrustDecision = {
  acceptedAt: string
  manifestDigest: string
  /** Required when archive has no declared sha256 */
  explicitNoSha: boolean
}

export type PrepareRequest = {
  agent: AcpRegistryAgentMetadata
  distribution: AcpRegistryDistributionKind
  target: AcpRegistryTarget
  /** Absolute agents root, e.g. ~/.swarmdesk-agent/agents */
  agentsRoot: string
  trust?: PrepareTrustDecision
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Skip network download; use local file path as archive (tests) */
  localArchivePath?: string
  /** Always enforced even when a caller cancellation signal is supplied. */
  downloadTimeoutMs?: number
  /** Per-request connection/header deadline, bounded by downloadTimeoutMs. */
  downloadHeaderTimeoutMs?: number
  /** No-progress stall deadline for the response body. A download that keeps receiving
   *  bytes is never killed; only a body that receives nothing for this long aborts. */
  downloadStallTimeoutMs?: number
  /** Trusted/test resolver environment; never materialized into the agent environment. */
  runnerEnv?: NodeJS.ProcessEnv
}

export type PrepareResult = {
  installDir: string
  stagingDir: string
  distribution: AcpRegistryDistributionKind
  launchSpec: WorkerLaunchSpec & { runnerVersion?: string }
  command: string
  args: string[]
  env: Record<string, string>
  observedSha256?: string
  declaredSha256?: string
  packageSpec?: string
  runner?: ResolvedRunner
  resolvedExecutable?: string
  trustDecision?: PrepareTrustDecision
  payloadDigest?: string
}

export class AcpInstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AcpInstallError'
  }
}

const locks = new Map<string, Promise<unknown>>()

async function withInstallLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const chained = prev.then(() => gate)
  locks.set(
    key,
    chained.catch(() => undefined),
  )
  await prev.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === chained) locks.delete(key)
  }
}

function safeSeg(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

export function installationTargetDir(input: {
  agentsRoot: string
  registryId: string
  registryVersion: string
  target: string
}): string {
  return join(
    input.agentsRoot,
    safeSeg(input.registryId),
    safeSeg(input.registryVersion),
    safeSeg(input.target),
  )
}

function stagingDirFor(finalDir: string): string {
  return `${finalDir}.staging.${process.pid}.${randomBytes(4).toString('hex')}`
}

type PreparedArtifactMetadata = {
  registryId: string
  registryVersion: string
  distribution: AcpRegistryDistributionKind
  target?: AcpRegistryTarget
  manifestDigest: string
  observedSha256?: string
  declaredSha256?: string
  launchSpec: WorkerLaunchSpec & { runnerVersion?: string }
  command: string
  args: string[]
  env: Record<string, string>
  packageSpec?: string
  runner?: ResolvedRunner
  resolvedExecutable?: string
  payloadFiles: Array<{ path: string; sha256: string; size: number }>
  payloadDigest: string
}

const PREPARED_METADATA_FILE = '.acp-install.json'

function readPreparedMetadata(installDir: string): PreparedArtifactMetadata | null {
  if (!existsSync(installDir)) return null
  try {
    const installStat = lstatSync(installDir)
    if (!installStat.isDirectory() || installStat.isSymbolicLink()) return null
    if (!lstatSync(join(installDir, PREPARED_METADATA_FILE)).isFile()) return null
    const parsed = JSON.parse(
      readFileSync(join(installDir, PREPARED_METADATA_FILE), 'utf8'),
    ) as PreparedArtifactMetadata
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.launchSpec ||
      !Array.isArray(parsed.args) ||
      !parsed.env ||
      typeof parsed.env !== 'object' ||
      !Array.isArray(parsed.launchSpec.runnerArgs) ||
      !Array.isArray(parsed.launchSpec.agentArgs) ||
      !parsed.launchSpec.env ||
      typeof parsed.launchSpec.env !== 'object' ||
      !Array.isArray(parsed.payloadFiles) ||
      typeof parsed.payloadDigest !== 'string'
    )
      return null
    return parsed
  } catch {
    return null
  }
}

function requestLaunchProjection(spec: WorkerLaunchSpec): unknown {
  return {
    distribution: spec.distribution,
    runnerArgs: spec.runnerArgs,
    packageSpec: spec.packageSpec,
    agentArgs: spec.agentArgs,
    env: spec.env,
    artifact: spec.artifact
      ? {
          archiveUrl: spec.artifact.archiveUrl,
          declaredSha256: spec.artifact.declaredSha256,
          executableRelativePath: spec.artifact.executableRelativePath,
        }
      : undefined,
  }
}

async function collectPayloadFiles(
  root: string,
): Promise<PreparedArtifactMetadata['payloadFiles']> {
  const files: PreparedArtifactMetadata['payloadFiles'] = []
  const rootPath = resolve(root)
  const walk = async (dir: string): Promise<void> => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en-US'),
    )
    for (const entry of entries) {
      if (dir === rootPath && entry.name === PREPARED_METADATA_FILE) continue
      const full = join(dir, entry.name)
      const stat = lstatSync(full)
      if (stat.isSymbolicLink()) {
        throw new AcpInstallError(
          'ACP_INSTALL_DIGEST_MISMATCH',
          'Prepared artifact contains a link',
        )
      }
      if (stat.isDirectory()) {
        await walk(full)
        continue
      }
      if (!stat.isFile()) {
        throw new AcpInstallError(
          'ACP_INSTALL_DIGEST_MISMATCH',
          'Prepared artifact contains a special file',
        )
      }
      const path = relative(rootPath, full).split(sep).join('/')
      files.push({ path, sha256: await sha256File(full), size: stat.size })
    }
  }
  await walk(rootPath)
  return files
}

function payloadInventoryDigest(files: PreparedArtifactMetadata['payloadFiles']): string {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

async function assertPayloadFiles(
  installDir: string,
  expected: PreparedArtifactMetadata['payloadFiles'],
): Promise<void> {
  if (expected.length === 0) {
    throw new AcpInstallError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Prepared artifact file inventory is missing',
    )
  }
  for (const file of expected) {
    const full = resolve(installDir, file.path)
    const root = resolve(installDir)
    if (full === root || !full.startsWith(`${root}${sep}`)) {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Prepared artifact inventory is invalid',
      )
    }
    let parent = root
    const components = file.path.split('/')
    for (const component of components.slice(0, -1)) {
      parent = join(parent, component)
      let parentStat
      try {
        parentStat = lstatSync(parent)
      } catch {
        throw new AcpInstallError(
          'ACP_INSTALL_DIGEST_MISMATCH',
          'Prepared artifact parent is missing',
        )
      }
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
        throw new AcpInstallError(
          'ACP_INSTALL_DIGEST_MISMATCH',
          'Prepared artifact parent is invalid',
        )
      }
    }
    let stat
    try {
      stat = lstatSync(full)
    } catch {
      throw new AcpInstallError('ACP_INSTALL_DIGEST_MISMATCH', 'Prepared artifact is incomplete')
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size) {
      throw new AcpInstallError('ACP_INSTALL_DIGEST_MISMATCH', 'Prepared artifact file is invalid')
    }
    if ((await sha256File(full)).toLowerCase() !== file.sha256.toLowerCase()) {
      throw new AcpInstallError('ACP_INSTALL_DIGEST_MISMATCH', 'Prepared artifact bytes changed')
    }
  }
}

function assertManagedInstallPath(agentsRoot: string, installDir: string): void {
  const root = resolve(agentsRoot)
  const target = resolve(installDir)
  const rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new AcpInstallError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Prepared installation is outside the managed artifact root',
    )
  }

  let current = root
  for (const component of rel.split(sep)) {
    current = join(current, component)
    let stat
    try {
      stat = lstatSync(current)
    } catch {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Prepared installation path is incomplete',
      )
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Prepared installation path contains an unmanaged link',
      )
    }
  }

  let canonicalRoot: string
  let canonicalTarget: string
  try {
    canonicalRoot = realpathSync(root)
    canonicalTarget = realpathSync(target)
  } catch {
    throw new AcpInstallError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Prepared installation path cannot be resolved',
    )
  }
  if (canonicalTarget === canonicalRoot || !canonicalTarget.startsWith(`${canonicalRoot}${sep}`)) {
    throw new AcpInstallError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Prepared installation resolves outside the managed artifact root',
    )
  }
}

async function assertReusablePreparedArtifact(input: {
  agentsRoot: string
  installDir: string
  registryId: string
  registryVersion: string
  distribution: AcpRegistryDistributionKind
  target?: AcpRegistryTarget
  manifestDigest: string
  expectedLaunchSpec: WorkerLaunchSpec
}): Promise<PreparedArtifactMetadata | undefined> {
  if (!existsSync(input.installDir)) return undefined
  assertManagedInstallPath(input.agentsRoot, input.installDir)
  const metadata = readPreparedMetadata(input.installDir)
  if (
    !metadata ||
    metadata.registryId !== input.registryId ||
    metadata.registryVersion !== input.registryVersion ||
    metadata.distribution !== input.distribution ||
    metadata.target !== input.target ||
    metadata.manifestDigest !== input.manifestDigest ||
    !isDeepStrictEqual(
      requestLaunchProjection(metadata.launchSpec),
      requestLaunchProjection(input.expectedLaunchSpec),
    )
  ) {
    throw new AcpInstallError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Existing installation identity or digest does not match the requested artifact',
    )
  }
  await assertPayloadFiles(input.installDir, metadata.payloadFiles)
  if (payloadInventoryDigest(metadata.payloadFiles) !== metadata.payloadDigest) {
    throw new AcpInstallError('ACP_INSTALL_DIGEST_MISMATCH', 'Prepared artifact inventory changed')
  }
  if (metadata.distribution === 'binary') {
    const executable = metadata.resolvedExecutable
    const root = resolve(input.installDir)
    if (
      !executable ||
      (resolve(executable) !== root && !resolve(executable).startsWith(`${root}${sep}`))
    ) {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Prepared executable is outside its installation',
      )
    }
    let stat
    try {
      stat = lstatSync(executable)
    } catch {
      throw new AcpInstallError('ACP_INSTALL_DIGEST_MISMATCH', 'Prepared executable is missing')
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      metadata.command !== executable ||
      metadata.launchSpec.executable !== executable
    ) {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Prepared executable facts are inconsistent',
      )
    }
  } else if (
    !metadata.runner ||
    metadata.command !== metadata.runner.command ||
    metadata.launchSpec.runnerCommand !== metadata.runner.command ||
    metadata.launchSpec.runnerVersion !== metadata.runner.version
  ) {
    throw new AcpInstallError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Prepared runner facts are inconsistent',
    )
  }
  return metadata
}

function metadataToPrepareResult(
  metadata: PreparedArtifactMetadata,
  installDir: string,
  trustDecision?: PrepareTrustDecision,
): PrepareResult {
  return {
    installDir,
    stagingDir: installDir,
    distribution: metadata.distribution,
    launchSpec: metadata.launchSpec,
    command: metadata.command,
    args: [...metadata.args],
    env: { ...metadata.env },
    observedSha256: metadata.observedSha256,
    declaredSha256: metadata.declaredSha256,
    packageSpec: metadata.packageSpec,
    runner: metadata.runner,
    resolvedExecutable: metadata.resolvedExecutable,
    trustDecision,
    payloadDigest: metadata.payloadDigest,
  }
}

function writePreparedMetadata(stagingDir: string, metadata: PreparedArtifactMetadata): void {
  writeFileSync(
    join(stagingDir, PREPARED_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  )
}

async function downloadToFile(
  url: string,
  destPath: string,
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    maxBytes?: number
    maxRedirects?: number
    totalTimeoutMs?: number
    headerTimeoutMs?: number
    /** No-progress deadline for the response body. A download that keeps receiving bytes is
     *  never aborted; only a body that receives nothing for this long is. Default 30s. */
    stallTimeoutMs?: number
  } = {},
): Promise<{ bytes: number }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? ARCHIVE_LIMITS.maxArchiveBytes
  const maxRedirects = options.maxRedirects ?? 5
  // Absolute safety valve (default 30 min): guards against a truly wedged download that never
  // errors and somehow never stalls. Normal downloads are bounded by stallTimeoutMs, not this.
  const totalTimeoutMs = options.totalTimeoutMs ?? 1_800_000
  const headerTimeoutMs = Math.min(options.headerTimeoutMs ?? 15_000, totalTimeoutMs)
  const stallTimeoutMs = Math.min(options.stallTimeoutMs ?? 30_000, totalTimeoutMs)
  const timeoutSignal = AbortSignal.timeout(totalTimeoutMs)
  const totalSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal
  let current = url
  for (let i = 0; i <= maxRedirects; i++) {
    const headerController = new AbortController()
    const onTotalAbort = () => headerController.abort(totalSignal.reason)
    if (totalSignal.aborted) onTotalAbort()
    else totalSignal.addEventListener('abort', onTotalAbort, { once: true })
    const headerTimer = setTimeout(() => {
      // A named DOMException lets the prepare catch classify a header deadline as a download
      // timeout rather than the generic 'Agent preparation failed' catch-all.
      const reason = new DOMException('Download header timeout', 'TimeoutError')
      headerController.abort(reason)
    }, headerTimeoutMs)
    // headerTimer must stay ref'd so AbortSignal.timeout races keep the event loop alive on Node 22
    let res: Response
    try {
      res = await fetchImpl(current, {
        signal: headerController.signal,
        redirect: 'manual',
        headers: { Accept: '*/*' },
      })
    } finally {
      clearTimeout(headerTimer)
      totalSignal.removeEventListener('abort', onTotalAbort)
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location')
      if (!loc)
        throw new AcpInstallError('ACP_INSTALL_DOWNLOAD_FAILED', 'Redirect without Location')
      current = new URL(loc, current).toString()
      if (!current.startsWith('https://')) {
        throw new AcpInstallError('ACP_INSTALL_DOWNLOAD_FAILED', 'Only https downloads allowed')
      }
      continue
    }
    if (!res.ok || !res.body) {
      throw new AcpInstallError(
        'ACP_INSTALL_DOWNLOAD_FAILED',
        `Download failed HTTP ${res.status}`,
      )
    }
    const len = res.headers.get('content-length')
    if (len && Number(len) > maxBytes) {
      throw new AcpInstallError('ACP_INSTALL_DOWNLOAD_FAILED', 'Content-Length exceeds limit')
    }
    mkdirSync(dirname(destPath), { recursive: true, mode: 0o700 })
    const out = createWriteStream(destPath, { mode: 0o600 })
    let received = 0
    const nodeBody = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
    // Progress-driven stall guard: the download is only killed when the body stops producing
    // bytes for stallTimeoutMs. A slow-but-steady stream runs as long as it keeps flowing.
    // The absolute totalTimeoutMs above remains the backstop for a fully wedged transfer.
    const stallController = new AbortController()
    const bodySignal = AbortSignal.any([totalSignal, stallController.signal])
    let lastProgressAt = Date.now()
    // Poll faster than the deadline so a stall is caught promptly even for short windows;
    // capped at 1s for the common 30s default to avoid busy-waiting.
    const stallPollMs = Math.max(50, Math.min(1000, Math.ceil(stallTimeoutMs / 4)))
    const stallTimer = setInterval(() => {
      if (Date.now() - lastProgressAt >= stallTimeoutMs) {
        stallController.abort(new DOMException('Download stalled', 'TimeoutError'))
      }
    }, stallPollMs)
    nodeBody.on('data', (chunk: Buffer) => {
      lastProgressAt = Date.now()
      received += chunk.length
      if (received > maxBytes) {
        nodeBody.destroy(
          new AcpInstallError('ACP_INSTALL_DOWNLOAD_FAILED', 'Download exceeds max bytes'),
        )
      }
    })
    try {
      await pipeline(nodeBody, out, { signal: bodySignal })
    } finally {
      clearInterval(stallTimer)
    }
    const fd = openSync(destPath, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    return { bytes: received }
  }
  throw new AcpInstallError('ACP_INSTALL_DOWNLOAD_FAILED', 'Too many redirects')
}

function findDistribution(
  agent: AcpRegistryAgentMetadata,
  kind: AcpRegistryDistributionKind,
): AcpRegistryPackageDistribution | AcpRegistryBinaryDistribution | null {
  const hit = agent.distributions.find((d) => d.kind === kind)
  return (hit as AcpRegistryPackageDistribution | AcpRegistryBinaryDistribution | undefined) ?? null
}

async function preparePackageAgent(input: PrepareRequest): Promise<PrepareResult> {
  const dist = findDistribution(input.agent, input.distribution)
  if (!dist || (dist.kind !== 'npx' && dist.kind !== 'uvx')) {
    throw new AcpInstallError(
      'ACP_REGISTRY_ENTRY_INVALID',
      `Agent ${input.agent.id} has no ${input.distribution} distribution`,
    )
  }
  // Package agents do not download archives; installDir is a marker directory.
  const installDir = installationTargetDir({
    agentsRoot: input.agentsRoot,
    registryId: input.agent.id,
    registryVersion: input.agent.version,
    target: `${input.distribution}`,
  })
  const stagingDir = stagingDirFor(installDir)
  const launchSpec = packageDistributionToLaunchSpec(dist)
  const reusable = await assertReusablePreparedArtifact({
    agentsRoot: input.agentsRoot,
    installDir,
    registryId: input.agent.id,
    registryVersion: input.agent.version,
    distribution: dist.kind,
    manifestDigest: input.agent.manifestDigest,
    expectedLaunchSpec: launchSpec,
  })
  if (reusable) return metadataToPrepareResult(reusable, installDir, input.trust)
  const runner = resolveAcpRunner(dist.kind, input.runnerEnv)
  const argv = buildPackageAgentArgv({
    kind: dist.kind,
    packageSpec: dist.package,
    agentArgs: dist.args,
    runner,
  })
  const resolvedLaunchSpec: WorkerLaunchSpec & { runnerVersion?: string } = {
    ...launchSpec,
    runnerCommand: argv.command,
    runnerVersion: runner.version,
  }
  try {
    rmSync(stagingDir, { recursive: true, force: true })
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 })
    // Marker file records prepared package spec (no third-party spawn here)
    const metaPath = join(stagingDir, 'package-prepare.json')
    const body = JSON.stringify(
      {
        registryId: input.agent.id,
        version: input.agent.version,
        distribution: dist.kind,
        packageSpec: dist.package,
        runnerCommand: runner.command,
        runnerVersion: runner.version,
        manifestDigest: input.agent.manifestDigest,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    )
    writeFileSync(metaPath, body, { mode: 0o600 })
    const payloadFiles = await collectPayloadFiles(stagingDir)
    const payloadDigest = payloadInventoryDigest(payloadFiles)
    writePreparedMetadata(stagingDir, {
      registryId: input.agent.id,
      registryVersion: input.agent.version,
      distribution: dist.kind,
      manifestDigest: input.agent.manifestDigest,
      launchSpec: resolvedLaunchSpec,
      command: argv.command,
      args: [...argv.args],
      env: { ...dist.env },
      packageSpec: dist.package,
      runner,
      payloadFiles,
      payloadDigest,
    })
    mkdirSync(dirname(installDir), { recursive: true, mode: 0o700 })
    if (existsSync(installDir)) {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Existing installation appeared during preparation',
      )
    }
    renameSync(stagingDir, installDir)
    return {
      installDir,
      stagingDir: installDir,
      distribution: dist.kind,
      launchSpec: resolvedLaunchSpec,
      command: argv.command,
      args: argv.args,
      env: { ...dist.env },
      packageSpec: dist.package,
      runner,
      trustDecision: input.trust,
      payloadDigest,
    }
  } catch (e) {
    rmSync(stagingDir, { recursive: true, force: true })
    if (e instanceof AcpInstallError) throw e
    throw new AcpInstallError('ACP_INSTALL_FAILED', 'Agent preparation failed')
  }
}

async function prepareBinaryAgent(input: PrepareRequest): Promise<PrepareResult> {
  const dist = findDistribution(input.agent, 'binary')
  if (!dist || dist.kind !== 'binary') {
    throw new AcpInstallError(
      'ACP_REGISTRY_ENTRY_INVALID',
      `Agent ${input.agent.id} has no binary distribution`,
    )
  }
  const launchSpec = binaryDistributionToLaunchSpec(dist, input.target)
  if (!launchSpec?.artifact) {
    throw new AcpInstallError(
      'ACP_PLATFORM_UNSUPPORTED',
      `No binary target ${input.target} for ${input.agent.id}`,
    )
  }
  const declared = launchSpec.artifact.declaredSha256
  if (!declared) {
    if (!input.trust?.explicitNoSha) {
      throw new AcpInstallError(
        'ACP_INSTALL_TRUST_REQUIRED',
        'Binary has no declared sha256; explicit trust decision required',
      )
    }
    if (input.trust.manifestDigest !== input.agent.manifestDigest) {
      throw new AcpInstallError(
        'ACP_INSTALL_TRUST_REQUIRED',
        'Trust decision manifestDigest does not match current catalog entry',
      )
    }
  }

  const installDir = installationTargetDir({
    agentsRoot: input.agentsRoot,
    registryId: input.agent.id,
    registryVersion: input.agent.version,
    target: input.target,
  })
  const stagingDir = stagingDirFor(installDir)
  // Keep the downloaded blob beside staging so any valid manifest path can be extracted.
  // Both paths share a filesystem, preserving atomic final promotion.
  const archivePath = `${stagingDir}.download`

  const reusable = await assertReusablePreparedArtifact({
    agentsRoot: input.agentsRoot,
    installDir,
    registryId: input.agent.id,
    registryVersion: input.agent.version,
    distribution: 'binary',
    target: input.target,
    manifestDigest: input.agent.manifestDigest,
    expectedLaunchSpec: launchSpec,
  })
  if (reusable) {
    if (
      declared &&
      reusable.observedSha256 &&
      declared.toLowerCase() !== reusable.observedSha256.toLowerCase()
    ) {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Existing installation digest does not match the requested artifact',
      )
    }
    return metadataToPrepareResult(reusable, installDir, input.trust)
  }

  try {
    rmSync(stagingDir, { recursive: true, force: true })
    rmSync(archivePath, { recursive: true, force: true })
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 })

    if (input.localArchivePath) {
      copyFileSync(input.localArchivePath, archivePath)
    } else {
      if (!launchSpec.artifact.archiveUrl.startsWith('https://')) {
        throw new AcpInstallError('ACP_INSTALL_FAILED', 'Archive URL must be https')
      }
      await downloadToFile(launchSpec.artifact.archiveUrl, archivePath, {
        fetchImpl: input.fetchImpl,
        signal: input.signal,
        totalTimeoutMs: input.downloadTimeoutMs,
        headerTimeoutMs: input.downloadHeaderTimeoutMs,
        stallTimeoutMs: input.downloadStallTimeoutMs,
      })
    }

    const observedSha256 = await sha256File(archivePath)
    if (declared && declared.toLowerCase() !== observedSha256) {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Declared sha256 does not match downloaded archive',
      )
    }

    const kind = detectArchiveKind(launchSpec.artifact.archiveUrl, readArchiveMagic(archivePath))
    const relCmd = launchSpec.artifact.executableRelativePath.replace(/^\.\//, '')
    await extractArchiveSafe(archivePath, stagingDir, kind, relCmd)

    // Remove the download blob from staging after extract (keep extracted tree)
    try {
      unlinkSync(archivePath)
    } catch {
      /* ok */
    }

    const resolvedExecutable = assertExecutableInsideStaging(stagingDir, relCmd)

    // Atomic promote
    mkdirSync(dirname(installDir), { recursive: true, mode: 0o700 })
    const finalExecutable = resolvedExecutable.replace(stagingDir, installDir)
    const finalSpec: WorkerLaunchSpec = {
      ...launchSpec,
      executable: finalExecutable,
      artifact: {
        ...launchSpec.artifact,
        observedSha256,
      },
    }

    const payloadFiles = await collectPayloadFiles(stagingDir)
    const payloadDigest = payloadInventoryDigest(payloadFiles)

    writePreparedMetadata(stagingDir, {
      registryId: input.agent.id,
      registryVersion: input.agent.version,
      distribution: 'binary',
      target: input.target,
      manifestDigest: input.agent.manifestDigest,
      observedSha256,
      declaredSha256: declared,
      launchSpec: finalSpec,
      command: finalExecutable,
      args: [...(launchSpec.agentArgs ?? [])],
      env: { ...launchSpec.env },
      resolvedExecutable: finalExecutable,
      payloadFiles,
      payloadDigest,
    })
    if (existsSync(installDir)) {
      throw new AcpInstallError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Existing installation appeared during preparation',
      )
    }
    renameSync(stagingDir, installDir)
    try {
      chmodSync(finalExecutable, 0o700)
    } catch {
      /* windows */
    }

    return {
      installDir,
      stagingDir: installDir,
      distribution: 'binary',
      launchSpec: finalSpec,
      command: finalExecutable,
      args: [...(launchSpec.agentArgs ?? [])],
      env: { ...launchSpec.env },
      observedSha256,
      declaredSha256: declared,
      resolvedExecutable: finalExecutable,
      trustDecision: input.trust,
      payloadDigest,
    }
  } catch (e) {
    rmSync(stagingDir, { recursive: true, force: true })
    rmSync(archivePath, { recursive: true, force: true })
    if (e instanceof AcpArchiveError) {
      throw new AcpInstallError('ACP_INSTALL_ARCHIVE_UNSAFE', e.message)
    }
    if (e instanceof AcpInstallError) throw e
    // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError'; fetch stream
    // teardown surfaces 'AbortError'. Both mean the download deadline fired — surface that
    // specifically instead of the generic 'Agent preparation failed' catch-all.
    const errName = (e as { name?: string } | null)?.name
    if (errName === 'TimeoutError' || errName === 'AbortError') {
      throw new AcpInstallError('ACP_INSTALL_DOWNLOAD_FAILED', 'Download timed out')
    }
    throw new AcpInstallError('ACP_INSTALL_FAILED', 'Agent preparation failed')
  }
}

/**
 * Prepare an agent distribution into agentsRoot. Per-install lock for concurrency.
 * The caller persists a non-ready `prepared` record; no probe or promotion occurs here.
 */
export async function prepareRegistryAgent(input: PrepareRequest): Promise<PrepareResult> {
  if (input.agent.manifestDigest && input.trust) {
    if (input.trust.manifestDigest !== input.agent.manifestDigest) {
      throw new AcpInstallError(
        'ACP_INSTALL_TRUST_REQUIRED',
        'Trust decision is stale relative to catalog digest',
      )
    }
  }
  const lockKey = `${input.agent.id}@${input.agent.version}:${input.distribution}:${input.target}`
  return withInstallLock(lockKey, async () => {
    if (input.distribution === 'npx' || input.distribution === 'uvx') {
      return preparePackageAgent(input)
    }
    if (input.distribution === 'binary') {
      return prepareBinaryAgent(input)
    }
    throw new AcpInstallError('ACP_REGISTRY_ENTRY_INVALID', `Unknown distribution`)
  })
}

export async function validatePreparedRegistryInstallation(input: {
  agentsRoot: string
  installDir: string
  registryId: string
  registryVersion: string
  distribution: AcpRegistryDistributionKind
  target?: AcpRegistryTarget
  manifestDigest: string
  expectedLaunchSpec: WorkerLaunchSpec
  expectedPayloadDigest: string
}): Promise<PrepareResult> {
  const metadata = await assertReusablePreparedArtifact(input)
  const expectedCommand =
    input.expectedLaunchSpec.distribution === 'binary'
      ? input.expectedLaunchSpec.executable
      : input.expectedLaunchSpec.runnerCommand
  const expectedArgs =
    input.expectedLaunchSpec.distribution === 'binary'
      ? [...input.expectedLaunchSpec.agentArgs]
      : [
          ...input.expectedLaunchSpec.runnerArgs,
          ...(input.expectedLaunchSpec.packageSpec ? [input.expectedLaunchSpec.packageSpec] : []),
          ...input.expectedLaunchSpec.agentArgs,
        ]
  if (
    !metadata ||
    metadata.payloadDigest !== input.expectedPayloadDigest ||
    !isDeepStrictEqual(metadata.launchSpec, input.expectedLaunchSpec) ||
    metadata.command !== expectedCommand ||
    !isDeepStrictEqual(metadata.args, expectedArgs) ||
    !isDeepStrictEqual(metadata.env, input.expectedLaunchSpec.env)
  ) {
    throw new AcpInstallError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Prepared artifact does not match the immutable installation record',
    )
  }
  return metadataToPrepareResult(metadata, input.installDir)
}

export function cleanupStaging(dir: string): void {
  if (existsSync(dir) && dir.includes('.staging.')) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (dir.includes('.staging.')) {
    rmSync(`${dir}.download`, { recursive: true, force: true })
  }
}
