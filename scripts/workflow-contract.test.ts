import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateCiWorkflow, validateReleaseWorkflow } from './workflow-contract.mjs'

describe('GitHub Actions workflow contract', () => {
  it('requires read-only CI with quality and three-platform package jobs', () => {
    assert.doesNotThrow(() =>
      validateCiWorkflow({
        on: { pull_request: null, push: { branches: ['main'] } },
        permissions: { contents: 'read' },
        jobs: {
          quality: {},
          package: {
            strategy: {
              matrix: {
                include: [
                  { os: 'macos-15', artifact: 'desktop-macos-arm64', builderArgs: '--mac --arm64' },
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
                ],
              },
            },
            steps: [
              { run: 'npm ci' },
              { run: 'npm run build:runtime' },
              { run: 'npm run verify:runtime' },
              { run: 'npx electron-builder --dir ${{ matrix.builderArgs }} --publish never' },
              { run: 'npm run smoke:packaged' },
            ],
          },
        },
      }),
    )
  })

  it('rejects CI workflows with write permission or a missing platform', () => {
    assert.throws(
      () =>
        validateCiWorkflow({
          on: { pull_request: {}, push: { branches: ['main'] } },
          permissions: { contents: 'write' },
          jobs: {
            quality: {},
            package: { strategy: { matrix: { include: [] } } },
          },
        }),
      /contents: read/,
    )
  })

  it('requires every native CI package job to build, verify PTY, and smoke its own runtime', () => {
    assert.throws(
      () =>
        validateCiWorkflow({
          on: { pull_request: null, push: { branches: ['main'] } },
          permissions: { contents: 'read' },
          jobs: {
            quality: {},
            package: {
              strategy: {
                matrix: {
                  include: [
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
                  ],
                },
              },
              steps: [{ run: 'npm run package:prepare' }],
            },
          },
        }),
      /build:runtime|verify:runtime|smoke:packaged/,
    )
  })

  it('requires tag/manual release triggers and isolates contents write', () => {
    assert.doesNotThrow(() =>
      validateReleaseWorkflow({
        on: {
          push: { tags: ['v*'] },
          workflow_dispatch: { inputs: { tag: { required: true } } },
        },
        permissions: { contents: 'read' },
        jobs: {
          package: {
            strategy: {
              matrix: {
                include: [
                  { os: 'macos-15', artifact: 'desktop-macos-arm64', builderArgs: '--mac --arm64' },
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
                ],
              },
            },
            steps: [
              { run: 'npm run build:runtime' },
              { run: 'npm run verify:runtime' },
              { run: 'npx electron-builder --dir ${{ matrix.builderArgs }} --publish never' },
              { run: 'npm run smoke:packaged' },
            ],
          },
          release: { permissions: { contents: 'write' } },
        },
      }),
    )
  })
})
