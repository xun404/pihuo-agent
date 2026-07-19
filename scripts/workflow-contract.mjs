function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const NATIVE_PACKAGE_TARGETS = [
  {
    os: 'macos-15',
    artifact: 'desktop-macos-arm64',
    builderArgs: '--mac --arm64',
  },
  {
    os: 'windows-2025',
    artifact: 'desktop-windows-x64',
    builderArgs: '--win --x64',
  },
  {
    os: 'ubuntu-24.04',
    artifact: 'desktop-linux-x64',
    builderArgs: '--linux --x64',
  },
]

function validateNativePackageJob(job, label) {
  const entries = job?.strategy?.matrix?.include
  assert(Array.isArray(entries), `${label} package matrix is required`)
  for (const expected of NATIVE_PACKAGE_TARGETS) {
    assert(
      entries.some(
        (entry) =>
          entry?.os === expected.os &&
          entry?.artifact === expected.artifact &&
          entry?.builderArgs === expected.builderArgs,
      ),
      `${label} package matrix is missing native ${expected.artifact}`,
    )
  }

  const commands = (job?.steps ?? [])
    .map((step) => (typeof step?.run === 'string' ? step.run : ''))
    .join('\n')
  for (const command of [
    'npm run build:runtime',
    'npm run verify:runtime',
    'electron-builder --dir',
    'npm run smoke:packaged',
  ]) {
    assert(commands.includes(command), `${label} native package job must run ${command}`)
  }
}

export function validateCiWorkflow(workflow) {
  assert(Object.hasOwn(workflow?.on ?? {}, 'pull_request'), 'CI must run on pull_request')
  assert(workflow?.on?.push?.branches?.includes('main'), 'CI must run on pushes to main')
  assert(workflow?.permissions?.contents === 'read', 'CI workflow must use contents: read')
  assert(workflow?.jobs?.quality, 'CI quality job is required')
  assert(workflow?.jobs?.package, 'CI package job is required')

  validateNativePackageJob(workflow.jobs.package, 'CI')
}

export function validateReleaseWorkflow(workflow) {
  assert(workflow?.on?.push?.tags?.includes('v*'), 'Release workflow must run on v* tags')
  assert(
    workflow?.on?.workflow_dispatch?.inputs?.tag?.required === true,
    'Release workflow_dispatch must require a tag',
  )
  assert(
    workflow?.permissions?.contents === 'read',
    'Release workflow must default to contents: read',
  )
  assert(workflow?.jobs?.package, 'Release package job is required')
  assert(workflow?.jobs?.release, 'Release aggregation job is required')
  assert(
    workflow.jobs.release.permissions?.contents === 'write',
    'Only the release aggregation job may request contents: write',
  )
  validateNativePackageJob(workflow.jobs.package, 'Release')
}
