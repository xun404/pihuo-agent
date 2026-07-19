type Distribution = 'npx' | 'uvx' | 'binary'

export type SmokeSelection = {
  registryId: string
  distribution?: Distribution
}

type CatalogAgent = {
  id: string
  name?: string
  version: string
  manifestDigest: string
  distributions: Array<{ kind: Distribution }>
}

type SmokeServices = {
  getCatalog(): Promise<{ agentsV2: CatalogAgent[] }>
  prepare(
    body: {
      registryId: string
      version: string
      distribution: Distribution
      manifestDigest: string
      trust?: { explicitNoSha: boolean }
    },
    options: { signal: AbortSignal },
  ): Promise<{ installationId: string }>
  register(body: {
    registryId: string
    version: string
    distribution: Distribution
    manifestDigest: string
    installationId: string
    name?: string
    enabled: boolean
  }): Promise<{ worker: { id: string } }>
  probe(
    workerId: string,
    options: { signal: AbortSignal },
  ): Promise<{
    worker: {
      readiness?: {
        status?: string
        code?: string
        nextAction?: string
      }
    }
  }>
  publicError(error: unknown): { error: string; code: string; status: number }
}

export type SmokeResult = {
  registryId: string
  distribution?: Distribution
  status: 'pass' | 'auth_required' | 'runner_missing' | 'platform_unsupported' | 'upstream_failed'
  code: string
  nextAction?: string
}

const SAFE_NEXT_ACTIONS = new Set([
  'none',
  'retry',
  'authenticate',
  'configure_env_secret',
  'open_terminal_auth',
  'install_runner',
  'choose_distribution',
  'update_application',
])

function safeCode(value: unknown, fallback = 'ACP_INSTALL_FAILED'): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) ? value : fallback
}

function classifyCode(codeValue: unknown): SmokeResult['status'] {
  const code = safeCode(codeValue)
  if (code === 'ACP_RUNNER_MISSING') return 'runner_missing'
  if (code === 'ACP_PLATFORM_UNSUPPORTED') return 'platform_unsupported'
  if (code === 'WORKER_AUTH_REQUIRED') return 'auth_required'
  if (code === 'SESSION_READY') return 'pass'
  return 'upstream_failed'
}

function failure(
  selection: SmokeSelection,
  codeValue: unknown,
  distribution = selection.distribution,
): SmokeResult {
  const code = safeCode(codeValue)
  return {
    registryId: selection.registryId,
    ...(distribution ? { distribution } : {}),
    status: classifyCode(code),
    code,
  }
}

function interrupted(selection: SmokeSelection): SmokeResult {
  return failure(selection, 'SMOKE_INTERRUPTED')
}

function resultFromReadiness(
  selection: SmokeSelection,
  distribution: Distribution,
  readiness: { status?: string; code?: string; nextAction?: string } | undefined,
): SmokeResult {
  const code = safeCode(
    readiness?.code,
    readiness?.status === 'ready'
      ? 'SESSION_READY'
      : readiness?.status === 'auth_required'
        ? 'WORKER_AUTH_REQUIRED'
        : 'WORKER_NOT_READY',
  )
  const status =
    readiness?.status === 'ready'
      ? 'pass'
      : readiness?.status === 'auth_required'
        ? 'auth_required'
        : classifyCode(code)
  const nextAction = SAFE_NEXT_ACTIONS.has(readiness?.nextAction ?? '')
    ? readiness!.nextAction
    : undefined
  return {
    registryId: selection.registryId,
    distribution,
    status,
    code,
    ...(nextAction ? { nextAction } : {}),
  }
}

/**
 * Orchestrates only the public production service sequence. Installer and ACP
 * probe behavior remain owned by those services and are never copied here.
 */
export async function runRegistrySmoke(input: {
  selections: SmokeSelection[]
  allowUnverifiedBinary: boolean
  shouldStop: () => boolean
  signal: AbortSignal
  services: SmokeServices
}): Promise<SmokeResult[]> {
  let catalog: Awaited<ReturnType<SmokeServices['getCatalog']>>
  try {
    catalog = await input.services.getCatalog()
  } catch (error) {
    const code = safeCode(input.services.publicError(error).code)
    return input.selections.map((selection) => failure(selection, code))
  }

  const results: SmokeResult[] = []
  for (let index = 0; index < input.selections.length; index += 1) {
    const selection = input.selections[index]!
    if (input.shouldStop() || input.signal.aborted) {
      results.push(...input.selections.slice(index).map(interrupted))
      break
    }
    const agent = catalog.agentsV2.find((candidate) => candidate.id === selection.registryId)
    if (!agent) {
      results.push(failure(selection, 'ACP_REGISTRY_ENTRY_INVALID'))
      continue
    }
    const selectedDistribution = selection.distribution
      ? agent.distributions.find((entry) => entry.kind === selection.distribution)
      : agent.distributions[0]
    if (!selectedDistribution) {
      results.push(failure(selection, 'ACP_REGISTRY_ENTRY_INVALID'))
      continue
    }
    const distribution = selectedDistribution.kind
    try {
      const prepared = await input.services.prepare(
        {
          registryId: agent.id,
          version: agent.version,
          distribution,
          manifestDigest: agent.manifestDigest,
          ...(distribution === 'binary' && input.allowUnverifiedBinary
            ? { trust: { explicitNoSha: true } }
            : {}),
        },
        { signal: input.signal },
      )
      if (input.shouldStop() || input.signal.aborted) {
        results.push(interrupted({ ...selection, distribution }))
        results.push(...input.selections.slice(index + 1).map(interrupted))
        break
      }
      const registered = await input.services.register({
        registryId: agent.id,
        version: agent.version,
        distribution,
        manifestDigest: agent.manifestDigest,
        installationId: prepared.installationId,
        ...(agent.name ? { name: agent.name } : {}),
        enabled: true,
      })
      if (input.shouldStop() || input.signal.aborted) {
        results.push(interrupted({ ...selection, distribution }))
        results.push(...input.selections.slice(index + 1).map(interrupted))
        break
      }
      const probed = await input.services.probe(registered.worker.id, { signal: input.signal })
      if (input.shouldStop() || input.signal.aborted) {
        results.push(interrupted({ ...selection, distribution }))
        results.push(...input.selections.slice(index + 1).map(interrupted))
        break
      }
      results.push(resultFromReadiness(selection, distribution, probed.worker.readiness))
    } catch (error) {
      if (input.shouldStop() || input.signal.aborted) {
        results.push(interrupted({ ...selection, distribution }))
        results.push(...input.selections.slice(index + 1).map(interrupted))
        break
      }
      const code = safeCode(input.services.publicError(error).code)
      results.push(failure(selection, code, distribution))
    }
  }
  return results
}
