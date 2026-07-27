import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { materializeWorkerLaunch } from './acp-launch-spec.js'

describe('materializeWorkerLaunch', () => {
  it('prefers a managed executable over the npx package projection', () => {
    assert.deepEqual(
      materializeWorkerLaunch({
        distribution: 'npx',
        runnerCommand: '/trusted/npx',
        runnerArgs: ['--yes'],
        packageSpec: '@example/agent@1.2.3',
        executable: '/managed/agent/dist/cli.js',
        interpreter: '/trusted/node',
        agentArgs: ['--acp'],
        env: { ACP_MODE: 'stdio' },
      }),
      {
        command: '/trusted/node',
        args: ['/managed/agent/dist/cli.js', '--acp'],
        env: { ACP_MODE: 'stdio' },
      },
    )
  })

  it('keeps the immutable legacy package projection when no local executable exists', () => {
    assert.deepEqual(
      materializeWorkerLaunch({
        distribution: 'npx',
        runnerCommand: '/trusted/npx',
        runnerArgs: ['--yes'],
        packageSpec: '@example/agent@1.2.3',
        agentArgs: ['--acp'],
        env: {},
      }),
      {
        command: '/trusted/npx',
        args: ['--yes', '@example/agent@1.2.3', '--acp'],
        env: {},
      },
    )
  })
})
