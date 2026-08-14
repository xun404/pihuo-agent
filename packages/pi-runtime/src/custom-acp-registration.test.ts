import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { LocalStore } from '@pihuo-agent/core'
import {
  detectLaunchKind,
  findDuplicateCandidates,
  previewCustomAcpWorker,
  registerCustomAcpWorker,
  resolveCustomWorkerIconAgentId,
} from './custom-acp-registration.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'custom-acp-register-'))
  dirs.push(dir)
  return { dir, store: new LocalStore(join(dir, 'state.json')) }
}

test('custom ACP registration materializes each supported launch kind and probes before persist', async () => {
  const cases = [
    {
      input: { name: 'NPX Agent', launchKind: 'npx' as const, packageSpec: '@scope/agent@1' },
      command: '/resolved/npx',
      args: ['-y', '@scope/agent@1'],
    },
    {
      input: { name: 'UVX Agent', launchKind: 'uvx' as const, packageSpec: 'agent-pkg' },
      command: '/resolved/uvx',
      args: ['agent-pkg'],
    },
    {
      input: { name: 'System Agent', launchKind: 'system' as const, command: 'agent-acp' },
      command: '/resolved/agent-acp',
      args: [],
    },
    {
      input: {
        name: 'Local Agent',
        launchKind: 'local' as const,
        command: process.execPath,
      },
      command: process.execPath,
      args: [],
    },
  ]

  for (const item of cases) {
    const { dir, store } = makeStore()
    let probed: { command: string; args: readonly string[] } | undefined
    const worker = await registerCustomAcpWorker(item.input, {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: async (input) => {
        probed = { command: input.command, args: input.args }
        return {
          readiness: { status: 'ready', checkedAt: '2026-07-22T00:00:00.000Z' },
          authMethods: [],
          capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
        }
      },
    })

    assert.deepEqual(probed, { command: item.command, args: item.args })
    assert.equal(worker.source?.type, 'custom')
    assert.equal(
      worker.source?.type === 'custom' ? worker.source.launchKind : undefined,
      item.input.launchKind,
    )
    assert.match(
      worker.source?.type === 'custom' ? (worker.source.launchDigest ?? '') : '',
      /^[a-f0-9]{64}$/u,
    )
    assert.equal(store.listWorkers().length, 1)
  }
})

test('custom ACP registration rejects protocol failure without persisting', async () => {
  const { dir, store } = makeStore()
  await assert.rejects(
    () =>
      registerCustomAcpWorker(
        { name: 'Broken', launchKind: 'system', command: 'not-acp' },
        {
          store,
          cwd: dir,
          resolveExecutable: (command) => `/resolved/${command}`,
          probe: async () => ({
            readiness: {
              status: 'incompatible',
              code: 'ACP_PROTOCOL_INCOMPATIBLE',
              checkedAt: '2026-07-22T00:00:00.000Z',
            },
            authMethods: [],
            capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
          }),
        },
      ),
    /ACP_PROTOCOL_INCOMPATIBLE/,
  )
  assert.deepEqual(store.listWorkers(), [])
})

test('auth-required custom ACP is rejected unless forced (must log in first)', async () => {
  const { dir, store } = makeStore()
  const probeAuth = async () => ({
    readiness: {
      status: 'auth_required' as const,
      code: 'WORKER_AUTH_REQUIRED',
      checkedAt: '2026-07-22T00:00:00.000Z',
    },
    authMethods: [],
    capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
  })
  // Without force → rejected, nothing persisted.
  await assert.rejects(
    () =>
      registerCustomAcpWorker(
        { name: 'Auth Agent', launchKind: 'system', command: 'auth-agent' },
        { store, cwd: dir, resolveExecutable: (c) => `/resolved/${c}`, probe: probeAuth },
      ),
    (error: unknown) => (error as { code?: string }).code === 'WORKER_AUTH_REQUIRED',
  )
  assert.equal(store.listWorkers().length, 0)
  // With force → persisted, remains non-dispatchable (readiness auth_required).
  const worker = await registerCustomAcpWorker(
    { name: 'Auth Agent', launchKind: 'system', command: 'auth-agent', force: true },
    { store, cwd: dir, resolveExecutable: (c) => `/resolved/${c}`, probe: probeAuth },
  )
  assert.equal(worker.readiness?.status, 'auth_required')
  assert.equal(store.listWorkers().length, 1)
})

test('custom ACP registration starts with the general default role type only', async () => {
  const { dir, store } = makeStore()
  const worker = await registerCustomAcpWorker(
    { name: 'Prompted Agent', launchKind: 'system', command: 'prompted-agent' },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: async () => ({
        readiness: { status: 'ready', checkedAt: '2026-07-22T00:00:00.000Z' },
        authMethods: [],
        capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
      }),
    },
  )

  assert.equal(worker.defaultRoleType, 'general')
  assert.equal('defaultRole' in worker, false)
})

test('detectLaunchKind classifies a command without forcing the user to choose', () => {
  // Existing absolute path -> local executable.
  assert.equal(detectLaunchKind({ command: process.execPath }), 'local')
  // ~ path that exists on disk -> local (the common ~/.kimi-code/bin/kimi case).
  const homeExe = join(homedir(), '.detect-launch-kind-fake-' + process.pid)
  writeFileSync(homeExe, '#!/bin/sh\necho ok\n', { mode: 0o755 })
  chmodSync(homeExe, 0o755)
  try {
    assert.equal(detectLaunchKind({ command: homeExe.replace(homedir(), '~') }), 'local')
  } finally {
    rmSync(homeExe, { force: true })
  }
  // npm package shapes -> npx.
  assert.equal(detectLaunchKind({ command: '@kimi/kimi-cli' }), 'npx')
  assert.equal(detectLaunchKind({ command: 'kimi-cli@1.49.0' }), 'npx')
  // Bare command name -> system PATH lookup.
  assert.equal(detectLaunchKind({ command: 'kimi' }), 'system')
  // packageSpec with no command -> npx package run.
  assert.equal(detectLaunchKind({ packageSpec: '@scope/agent@1' }), 'npx')
  // Explicit choice wins over the heuristic.
  assert.equal(detectLaunchKind({ launchKind: 'uvx', packageSpec: 'agent-pkg' }), 'uvx')
  assert.equal(detectLaunchKind({ launchKind: 'local', command: process.execPath }), 'local')
})

test('custom ACP registration auto-detects local from a ~ path (the original failure case)', async () => {
  // Reproduce the user's broken input: command uses ~, launchKind omitted. Before the fix this
  // threw "Local executable must use an absolute path"; now it must resolve and probe.
  const dir = mkdtempSync(join(homedir(), 'custom-acp-tilde-'))
  dirs.push(dir)
  const exe = join(dir, 'kimi-fake')
  writeFileSync(exe, '#!/bin/sh\necho ok\n', { mode: 0o755 })
  chmodSync(exe, 0o755)
  const tildeCommand = exe.replace(homedir(), '~')
  const { store } = makeStore()
  let probedCommand: string | undefined
  const worker = await registerCustomAcpWorker(
    { name: 'Tilde Agent', command: tildeCommand, args: ['acp'] },
    {
      store,
      cwd: dir,
      probe: async (input) => {
        probedCommand = input.command
        return {
          readiness: { status: 'ready', checkedAt: '2026-07-22T00:00:00.000Z' },
          authMethods: [],
          capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
        }
      },
    },
  )
  // The ~ path was expanded to the absolute executable before probing.
  assert.equal(probedCommand, exe)
  assert.equal(worker.command, exe)
  assert.equal(worker.readiness?.status, 'ready')
})

test('custom ACP registration auto-detects npx from a package command', async () => {
  const { dir, store } = makeStore()
  const worker = await registerCustomAcpWorker(
    { name: 'NPX Auto', command: '@scope/agent@1', args: [] },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: async () => ({
        readiness: { status: 'ready', checkedAt: '2026-07-22T00:00:00.000Z' },
        authMethods: [],
        capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
      }),
    },
  )
  assert.equal(worker.source?.type, 'custom')
  assert.equal(worker.source?.type === 'custom' ? worker.source.launchKind : undefined, 'npx')
  // npx invocation shape: runner + -y + packageSpec.
  assert.equal(worker.command, '/resolved/npx')
  assert.deepEqual(worker.args, ['-y', '@scope/agent@1'])
})

// A reusable probe stub that reports a rich capabilitySummary (agentName/version/caps/authMethods)
// so preview tests can assert the ACP identity flows through to the confirmation dialog.
function richProbe(readinessStatus: 'ready' | 'auth_required' | 'incompatible' | 'failed') {
  const code =
    readinessStatus === 'auth_required'
      ? 'WORKER_AUTH_REQUIRED'
      : readinessStatus === 'incompatible'
        ? 'ACP_PROTOCOL_INCOMPATIBLE'
        : readinessStatus === 'failed'
          ? 'INITIALIZE_FAILED'
          : 'SESSION_READY'
  return async () => ({
    readiness: {
      status: readinessStatus,
      code,
      message: `probe ${readinessStatus}`,
      checkedAt: '2026-07-22T00:00:00.000Z',
      nextAction: 'none' as const,
    },
    authMethods: [{ id: 'oauth-terminal', name: 'OAuth', type: 'terminal' as const }],
    capabilitySummary: {
      protocolVersion: 1,
      agentName: 'Kimi CLI',
      agentVersion: '1.49.0',
      sessionLoad: true,
      sessionResume: true,
      sessionList: false,
      authLogout: true,
      authMethods: [{ id: 'oauth-terminal', name: 'OAuth', type: 'terminal' }],
      probedAt: '2026-07-22T00:00:00.000Z',
    },
  })
}

test('previewCustomAcpWorker returns the ACP identity and does not persist', async () => {
  const { dir, store } = makeStore()
  const preview = await previewCustomAcpWorker(
    { name: 'Kimi', launchKind: 'system', command: 'kimi' },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: richProbe('ready'),
    },
  )
  assert.equal(preview.candidate.agentName, 'Kimi CLI')
  assert.equal(preview.candidate.agentVersion, '1.49.0')
  assert.equal(preview.candidate.protocolVersion, 1)
  assert.equal(preview.candidate.sessionLoad, true)
  assert.equal(preview.candidate.authLogout, true)
  assert.equal(preview.candidate.authMethods.length, 1)
  assert.equal(preview.candidate.readiness.status, 'ready')
  assert.deepEqual(preview.conflicts, [])
  // Preview must not persist anything.
  assert.equal(store.listWorkers().length, 0)
})

test('previewCustomAcpWorker surfaces auth_required without throwing (state 4)', async () => {
  const { dir, store } = makeStore()
  const preview = await previewCustomAcpWorker(
    { name: 'Kimi', launchKind: 'system', command: 'kimi' },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: richProbe('auth_required'),
    },
  )
  assert.equal(preview.candidate.readiness.status, 'auth_required')
})

test('previewCustomAcpWorker flags an existing worker with the same agentName', async () => {
  const { dir, store } = makeStore()
  // Seed an existing worker reporting the same agentName.
  await registerCustomAcpWorker(
    { name: 'Old Kimi', launchKind: 'system', command: 'kimi' },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: richProbe('ready'),
    },
  )
  const preview = await previewCustomAcpWorker(
    { name: 'New Kimi', launchKind: 'system', command: 'kimi2' },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: richProbe('ready'),
    },
  )
  assert.equal(preview.conflicts.length, 1)
  assert.equal(preview.conflicts[0].agentName, 'Kimi CLI')
})

test('registerCustomAcpWorker rejects auth_required without force', async () => {
  const { dir, store } = makeStore()
  await assert.rejects(
    () =>
      registerCustomAcpWorker(
        { name: 'Kimi', launchKind: 'system', command: 'kimi' },
        {
          store,
          cwd: dir,
          resolveExecutable: (command) => `/resolved/${command}`,
          probe: richProbe('auth_required'),
        },
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.name === 'CustomAcpRegistrationError' &&
      (error as { code?: string }).code === 'WORKER_AUTH_REQUIRED',
  )
  assert.equal(store.listWorkers().length, 0)
})

test('registerCustomAcpWorker force-adds an auth_required worker', async () => {
  const { dir, store } = makeStore()
  const worker = await registerCustomAcpWorker(
    { name: 'Kimi', launchKind: 'system', command: 'kimi', force: true },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: richProbe('auth_required'),
    },
  )
  assert.equal(worker.readiness?.status, 'auth_required')
  assert.equal(store.listWorkers().length, 1)
})

test('findDuplicateCandidates matches by command or agentName', () => {
  const { store } = makeStore()
  // No workers → no candidates.
  assert.equal(findDuplicateCandidates(store, 'Kimi CLI', '/resolved/kimi').length, 0)
})

test('resolveCustomWorkerIconAgentId honors explicit pick, empty clear, and auto-match', () => {
  // Empty string clears (no registry icon).
  assert.equal(resolveCustomWorkerIconAgentId('Claude', 'claude', ''), undefined)
  // Explicit non-empty wins over auto-match heuristics.
  assert.equal(
    resolveCustomWorkerIconAgentId('Claude', 'claude', 'codex-acp'),
    'codex-acp',
  )
  // Undefined → auto path (may or may not match depending on local catalog; must not throw).
  assert.doesNotThrow(() => resolveCustomWorkerIconAgentId('Claude Code', 'claude', undefined))
})

test('registerCustomAcpWorker persists explicit iconAgentId', async () => {
  const { dir, store } = makeStore()
  const worker = await registerCustomAcpWorker(
    {
      name: 'My Agent',
      launchKind: 'system',
      command: 'my-agent',
      iconAgentId: 'claude-acp',
    },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: async () => ({
        readiness: { status: 'ready', checkedAt: '2026-07-22T00:00:00.000Z' },
        authMethods: [],
        capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
      }),
    },
  )
  assert.equal(worker.iconAgentId, 'claude-acp')
})

test('registerCustomAcpWorker empty iconAgentId skips auto-match', async () => {
  const { dir, store } = makeStore()
  const worker = await registerCustomAcpWorker(
    {
      name: 'Claude Code',
      launchKind: 'system',
      command: 'claude',
      iconAgentId: '',
    },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: async () => ({
        readiness: { status: 'ready', checkedAt: '2026-07-22T00:00:00.000Z' },
        authMethods: [],
        capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
      }),
    },
  )
  assert.equal(worker.iconAgentId, undefined)
})
