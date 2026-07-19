/**
 * Project structured WorkerLaunchSpec from registry distributions.
 */
import type {
  AcpRegistryBinaryDistribution,
  AcpRegistryDistribution,
  AcpRegistryPackageDistribution,
  AcpRegistryTarget,
  WorkerLaunchSpec,
} from '@swarmdesk-agent/shared'

export function packageDistributionToLaunchSpec(
  dist: AcpRegistryPackageDistribution,
): WorkerLaunchSpec {
  if (dist.kind === 'npx') {
    return {
      distribution: 'npx',
      runnerCommand: 'npx',
      runnerArgs: ['--yes'],
      packageSpec: dist.package,
      agentArgs: [...dist.args],
      env: { ...dist.env },
    }
  }
  return {
    distribution: 'uvx',
    runnerCommand: 'uvx',
    runnerArgs: [],
    packageSpec: dist.package,
    agentArgs: [...dist.args],
    env: { ...dist.env },
  }
}

export function binaryDistributionToLaunchSpec(
  dist: AcpRegistryBinaryDistribution,
  target: AcpRegistryTarget,
): WorkerLaunchSpec | null {
  const hit = dist.targets.find((t) => t.target === target)
  if (!hit) return null
  return {
    distribution: 'binary',
    runnerArgs: [],
    executable: hit.cmd,
    agentArgs: [...hit.args],
    env: { ...hit.env },
    artifact: {
      archiveUrl: hit.archiveUrl,
      declaredSha256: hit.sha256,
      executableRelativePath: hit.cmd,
    },
  }
}

/**
 * Default launch projection preference for legacy flat UI: npx > uvx > binary(on platform).
 * Does not discard other distributions — only picks a default for command/args preview.
 */
export function pickDefaultLaunchSpec(
  distributions: AcpRegistryDistribution[],
  target: AcpRegistryTarget | null,
): WorkerLaunchSpec | null {
  const npx = distributions.find((d): d is AcpRegistryPackageDistribution => d.kind === 'npx')
  if (npx) return packageDistributionToLaunchSpec(npx)
  const uvx = distributions.find((d): d is AcpRegistryPackageDistribution => d.kind === 'uvx')
  if (uvx) return packageDistributionToLaunchSpec(uvx)
  const binary = distributions.find((d): d is AcpRegistryBinaryDistribution => d.kind === 'binary')
  if (binary && target) {
    return binaryDistributionToLaunchSpec(binary, target)
  }
  if (binary) {
    // Platform unsupported — still return a binary shell so UI can show requiresLocalInstall
    return {
      distribution: 'binary',
      runnerArgs: [],
      agentArgs: [],
      env: {},
    }
  }
  return null
}

export function materializeCommandArgs(spec: WorkerLaunchSpec): {
  command: string
  args: string[]
  env: Record<string, string>
  requiresLocalInstall: boolean
} {
  if (spec.distribution === 'npx') {
    return {
      command: 'npx',
      args: [
        ...spec.runnerArgs,
        ...(spec.packageSpec ? [spec.packageSpec] : []),
        ...spec.agentArgs,
      ],
      env: { ...spec.env },
      requiresLocalInstall: false,
    }
  }
  if (spec.distribution === 'uvx') {
    return {
      command: 'uvx',
      args: [...(spec.packageSpec ? [spec.packageSpec] : []), ...spec.agentArgs],
      env: { ...spec.env },
      requiresLocalInstall: false,
    }
  }
  if (spec.distribution === 'binary') {
    const cmd = spec.executable?.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? ''
    return {
      command: cmd,
      args: [...spec.agentArgs],
      env: { ...spec.env },
      requiresLocalInstall: true,
    }
  }
  return {
    command: spec.executable ?? '',
    args: [...spec.agentArgs],
    env: { ...spec.env },
    requiresLocalInstall: false,
  }
}
