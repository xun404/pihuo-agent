function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// Windows packaging is temporarily disabled in CI/Release workflows (2026-07-20)
// due to GHA packaged-smoke hangs. Re-add when re-enabling the matrix entry.
const NATIVE_PACKAGE_TARGETS = [
  {
    os: 'macos-15',
    artifact: 'desktop-macos-arm64',
    builderArgs: '--mac --arm64',
  },
  {
    os: 'ubuntu-24.04',
    artifact: 'desktop-linux-x64',
    builderArgs: '--linux --x64',
  },
]

const REQUIRED_QUALITY_COMMANDS = [
  'npm test',
  'npm run typecheck',
  'npm run check:source-size',
  'npm run build',
]

function validateQualityCommands(job, label) {
  assert(job, `${label} quality job is required`)
  const commands = (job.steps ?? [])
    .map((step) => (typeof step?.run === 'string' ? step.run : ''))
    .join('\n')
  for (const command of REQUIRED_QUALITY_COMMANDS) {
    assert(commands.includes(command), `${label} quality job must run ${command}`)
  }
}

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
  validateQualityCommands(workflow?.jobs?.quality, 'CI')
  // Packaging is expensive and release-gated; PR/main CI is quality-only.
  assert(
    !workflow?.jobs?.package,
    'CI must not define a package job; desktop packaging runs only on release tags',
  )
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
  validateQualityCommands(workflow?.jobs?.quality, 'Release')
  assert(workflow?.jobs?.package, 'Release package job is required')
  assert(workflow?.jobs?.release, 'Release aggregation job is required')
  assert(
    workflow.jobs.release.permissions?.contents === 'write',
    'Only the release aggregation job may request contents: write',
  )
  validateNativePackageJob(workflow.jobs.package, 'Release')

  const releaseCommands = (workflow.jobs.release?.steps ?? [])
    .map((step) => (typeof step?.run === 'string' ? step.run : ''))
    .join('\n')
  assert(
    releaseCommands.includes('verify-release-notes.mjs'),
    'Release aggregation must validate docs/releases notes structure',
  )
  assert(
    releaseCommands.includes('--notes-file'),
    'Release aggregation must publish checked-in bilingual notes via --notes-file',
  )
  assert(
    !releaseCommands.includes('--generate-notes'),
    'Release aggregation must not rely on GitHub --generate-notes alone',
  )
}
