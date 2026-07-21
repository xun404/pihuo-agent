import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateCiWorkflow, validateReleaseWorkflow } from './workflow-contract.mjs'

describe('GitHub Actions workflow contract', () => {
  it('requires read-only CI with quality checks only (no packaging)', () => {
    assert.doesNotThrow(() =>
      validateCiWorkflow({
        on: { pull_request: null, push: { branches: ['main'] } },
        permissions: { contents: 'read' },
        jobs: {
          quality: {
            steps: [
              { run: 'npm ci' },
              { run: 'npm test' },
              { run: 'npm run typecheck' },
              { run: 'npm run lint' },
              { run: 'npm run build' },
            ],
          },
        },
      }),
    )
  })

  it('rejects CI workflows with write permission or a missing quality job', () => {
    assert.throws(
      () =>
        validateCiWorkflow({
          on: { pull_request: {}, push: { branches: ['main'] } },
          permissions: { contents: 'write' },
          jobs: {
            quality: {
              steps: [
                { run: 'npm test' },
                { run: 'npm run typecheck' },
                { run: 'npm run build' },
              ],
            },
          },
        }),
      /contents: read/,
    )
  })

  it('rejects CI workflows that still package desktop builds', () => {
    assert.throws(
      () =>
        validateCiWorkflow({
          on: { pull_request: null, push: { branches: ['main'] } },
          permissions: { contents: 'read' },
          jobs: {
            quality: {
              steps: [
                { run: 'npm test' },
                { run: 'npm run typecheck' },
                { run: 'npm run build' },
              ],
            },
            package: {
              strategy: {
                matrix: {
                  include: [
                    {
                      os: 'macos-15',
                      artifact: 'desktop-macos-arm64',
                      builderArgs: '--mac --arm64',
                    },
                  ],
                },
              },
              steps: [{ run: 'npx electron-builder --publish never' }],
            },
          },
        }),
      /must not define a package job/,
    )
  })

  it('requires CI quality to run tests, typecheck, and build', () => {
    assert.throws(
      () =>
        validateCiWorkflow({
          on: { pull_request: null, push: { branches: ['main'] } },
          permissions: { contents: 'read' },
          jobs: {
            quality: {
              steps: [{ run: 'npm ci' }],
            },
          },
        }),
      /npm test|typecheck|build/,
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
                  // Windows packaging temporarily disabled (matches release.yml).
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
