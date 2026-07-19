import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createWorkerDraftFromRegistry,
  filterWorkerRegistryOptions,
  mapCatalogResponseToOptions,
  moveWorkerRegistryHighlight,
  resolveWorkerRegistrationRoute,
  type WorkerRegistryOption,
} from './worker-registry.js'

const options: WorkerRegistryOption[] = [
  {
    id: 'claude-acp',
    name: 'Claude Agent',
    version: '0.59.0',
    description: 'Anthropic coding agent',
    icon: 'https://example.com/claude.svg',
    distribution: 'npx',
    command: 'npx',
    args: ['--yes', '@agentclientprotocol/claude-agent-acp@0.59.0'],
    env: {},
    requiresLocalInstall: false,
  },
  {
    id: 'fast-agent',
    name: 'Fast Agent',
    version: '0.9.10',
    description: 'Python research assistant',
    icon: 'https://example.com/fast.svg',
    distribution: 'uvx',
    command: 'uvx',
    args: ['fast-agent-acp==0.9.10'],
    env: {},
    requiresLocalInstall: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    version: '1.18.2',
    description: 'Native coding CLI',
    icon: 'https://example.com/opencode.svg',
    distribution: 'binary',
    command: 'opencode',
    args: ['acp'],
    env: {},
    requiresLocalInstall: true,
  },
]

describe('worker registry search', () => {
  it('prefers full v2 catalog facts while using the legacy projection only for launch preview', () => {
    const [mapped] = mapCatalogResponseToOptions({
      agents: [
        {
          ...options[0]!,
          name: 'Stale legacy name',
          distribution: 'npx',
          distributions: ['npx'],
          manifestDigest: 'legacy-digest',
        },
      ],
      agentsV2: [
        {
          id: 'claude-acp',
          name: 'Claude Agent v2',
          version: '0.60.0',
          description: 'Full metadata',
          repository: 'https://github.com/example/claude-acp',
          website: 'https://example.com/claude-acp',
          authors: [{ name: 'Example Author', url: 'https://example.com' }],
          license: 'MIT',
          manifestDigest: 'v2-digest',
          availability: 'available',
          platformTarget: 'darwin-aarch64',
          distributions: [
            { kind: 'npx', package: '@example/claude-acp@0.60.0', args: ['--acp'], env: {} },
            { kind: 'uvx', package: 'claude-acp==0.60.0', args: [], env: {} },
            {
              kind: 'binary',
              targets: [
                {
                  target: 'darwin-aarch64',
                  archiveUrl: 'https://downloads.example.com/claude-acp.tar.gz',
                  sha256: 'a'.repeat(64),
                  cmd: 'claude-acp',
                  args: ['--acp'],
                  env: {},
                },
              ],
            },
          ],
        },
      ],
    })

    assert.equal(mapped?.name, 'Claude Agent v2')
    assert.equal(mapped?.version, '0.60.0')
    assert.equal(mapped?.manifestDigest, 'v2-digest')
    assert.deepEqual(mapped?.distributions, ['npx', 'uvx', 'binary'])
    assert.equal(mapped?.repository, 'https://github.com/example/claude-acp')
    assert.equal(mapped?.authors?.[0]?.name, 'Example Author')
    assert.equal(mapped?.distributionDetails?.length, 3)
    assert.equal(mapped?.platformTarget, 'darwin-aarch64')
    assert.equal(mapped?.platformSupported, true)
    assert.equal(mapped?.command, 'npx')
  })

  it('keeps legacy-only catalog fixtures working', () => {
    const mapped = mapCatalogResponseToOptions({ agents: options })
    assert.deepEqual(
      mapped.map((entry) => entry.id),
      ['claude-acp', 'fast-agent', 'opencode'],
    )
    assert.deepEqual(mapped[0]?.distributions, ['npx'])
  })

  it('matches name, id, description and distribution case-insensitively', () => {
    assert.deepEqual(
      filterWorkerRegistryOptions(options, 'CLAUDE').map((item) => item.id),
      ['claude-acp'],
    )
    assert.deepEqual(
      filterWorkerRegistryOptions(options, 'research').map((item) => item.id),
      ['fast-agent'],
    )
    assert.deepEqual(
      filterWorkerRegistryOptions(options, 'binary').map((item) => item.id),
      ['opencode'],
    )
  })

  it('caps empty-query suggestions and keeps server ordering', () => {
    assert.deepEqual(
      filterWorkerRegistryOptions(options, '', 2).map((item) => item.id),
      ['claude-acp', 'fast-agent'],
    )
  })

  it('creates an editable registration draft and preserves registry env', () => {
    assert.deepEqual(createWorkerDraftFromRegistry(options[0]!), {
      selectedId: 'claude-acp',
      name: 'Claude Agent',
      command: 'npx',
      args: '--yes @agentclientprotocol/claude-agent-acp@0.59.0',
      env: {},
      kind: 'claude',
      description: 'Anthropic coding agent',
    })
    assert.equal(createWorkerDraftFromRegistry(options[2]!).kind, 'opencode')
    assert.equal(createWorkerDraftFromRegistry(options[1]!).kind, 'custom')
  })

  it('wraps keyboard highlight through the filtered options', () => {
    assert.equal(moveWorkerRegistryHighlight(-1, 'ArrowDown', 3), 0)
    assert.equal(moveWorkerRegistryHighlight(2, 'ArrowDown', 3), 0)
    assert.equal(moveWorkerRegistryHighlight(0, 'ArrowUp', 3), 2)
    assert.equal(moveWorkerRegistryHighlight(1, 'Home', 3), 1)
    assert.equal(moveWorkerRegistryHighlight(0, 'ArrowDown', 0), -1)
  })

  it('never routes a selected Registry id to custom when refresh removes its catalog row', () => {
    const selected = { ...options[0]!, manifestDigest: 'sha256:manifest' }
    assert.deepEqual(
      resolveWorkerRegistrationRoute(selected.id, selected, selected.manifestDigest),
      { kind: 'registry', option: selected },
    )
    assert.deepEqual(resolveWorkerRegistrationRoute(selected.id, null, selected.manifestDigest), {
      kind: 'registry_unavailable',
    })
    assert.deepEqual(resolveWorkerRegistrationRoute(null, null, ''), { kind: 'custom' })
  })
})
