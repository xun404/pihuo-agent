import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { LocalStore } from '@swarmdesk-agent/core'
import { registerCustomAcpWorker } from './custom-acp-registration.js'

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

test('auth-required custom ACP passes protocol registration but remains non-dispatchable', async () => {
  const { dir, store } = makeStore()
  const worker = await registerCustomAcpWorker(
    { name: 'Auth Agent', launchKind: 'system', command: 'auth-agent' },
    {
      store,
      cwd: dir,
      resolveExecutable: (command) => `/resolved/${command}`,
      probe: async () => ({
        readiness: {
          status: 'auth_required',
          code: 'WORKER_AUTH_REQUIRED',
          checkedAt: '2026-07-22T00:00:00.000Z',
        },
        authMethods: [],
        capabilitySummary: { probedAt: '2026-07-22T00:00:00.000Z' },
      }),
    },
  )
  assert.equal(worker.readiness?.status, 'auth_required')
  assert.equal(store.listWorkers().length, 1)
})
