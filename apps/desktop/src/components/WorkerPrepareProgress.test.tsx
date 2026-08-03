import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import type { RegistryOperationSnapshot, RegistryPrepareResult } from '../lib/api.js'
import { I18nProvider } from '../i18n/I18nProvider.js'
import {
  WorkerPrepareProgress,
  collapsePrepareLogEvents,
  pollRegistryOperationUntilTerminal,
  prepareStageLabel,
} from './WorkerPrepareProgress.js'

function operation(
  status: RegistryOperationSnapshot<RegistryPrepareResult>['status'],
): RegistryOperationSnapshot<RegistryPrepareResult> {
  return {
    operationId: 'op_fixture',
    kind: 'prepare',
    status,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:01.000Z',
    events: [
      {
        sequence: 1,
        at: '2026-07-17T00:00:01.000Z',
        status,
        stage: status,
        progress: status === 'running' ? 0.5 : undefined,
      },
    ],
    ...(status === 'succeeded'
      ? { result: { installationId: 'inst_fixture' } as RegistryPrepareResult }
      : {}),
  }
}

describe('WorkerPrepareProgress operation polling', () => {
  it('publishes ordered snapshots and stops at the terminal result', async () => {
    const responses = [operation('running'), operation('succeeded')]
    const seen: string[] = []
    const result = await pollRegistryOperationUntilTerminal({
      operationId: 'op_fixture',
      signal: new AbortController().signal,
      getOperation: async () => responses.shift()!,
      onSnapshot: (snapshot) => seen.push(snapshot.status),
      wait: async () => {},
    })

    assert.deepEqual(seen, ['running', 'succeeded'])
    assert.equal(result.result?.installationId, 'inst_fixture')
  })

  it('forwards cancellation into an active poll and starts no later request', async () => {
    const controller = new AbortController()
    let requests = 0
    const pending = pollRegistryOperationUntilTerminal({
      operationId: 'op_fixture',
      signal: controller.signal,
      getOperation: async (_id, signal) => {
        requests += 1
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        })
      },
      onSnapshot: () => {},
      wait: async () => {},
    })
    controller.abort()

    await assert.rejects(
      pending,
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    )
    assert.equal(requests, 1)
  })

  it('renders a stable failed code and localized retry action', () => {
    const failed = {
      ...operation('failed'),
      code: 'ACP_INSTALL_FAILED',
      error: 'Registry preparation failed',
    }
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { serverLocale: 'en' },
        createElement(WorkerPrepareProgress, {
          initial: failed,
          onSucceeded: () => {},
          onFailed: () => {},
          onRetry: () => {},
        }),
      ),
    )

    assert.match(html, /ACP_INSTALL_FAILED/u)
    assert.match(html, />Retry</u)
    assert.match(html, /worker-prepare-log/u)
  })

  it('collapses consecutive identical stages in the log', () => {
    const collapsed = collapsePrepareLogEvents([
      {
        sequence: 1,
        at: 't1',
        status: 'running',
        stage: 'installing',
        progress: 0.35,
      },
      {
        sequence: 2,
        at: 't2',
        status: 'running',
        stage: 'installing',
        progress: 0.4,
      },
      {
        sequence: 3,
        at: 't3',
        status: 'running',
        stage: 'finalizing',
        progress: 0.88,
      },
    ])
    assert.equal(collapsed.length, 2)
    assert.equal(collapsed[0]?.stage, 'installing')
    assert.equal(collapsed[0]?.progress, 0.4)
    assert.equal(collapsed[1]?.stage, 'finalizing')
  })

  it('maps prepare stages to localized labels', () => {
    const t = (key: string) => key
    assert.equal(
      prepareStageLabel('installing', 'running', t as never),
      'workers.registryPrepareStageInstalling',
    )
    assert.equal(
      prepareStageLabel('downloading', 'running', t as never),
      'workers.registryPrepareStageDownloading',
    )
    assert.equal(
      prepareStageLabel(undefined, 'succeeded', t as never),
      'workers.registryPrepareComplete',
    )
  })

  it('renders a stage log instead of a progress bar', () => {
    const running: RegistryOperationSnapshot<RegistryPrepareResult> = {
      operationId: 'op_fixture',
      kind: 'prepare',
      status: 'running',
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:03.000Z',
      events: [
        {
          sequence: 1,
          at: '2026-07-17T00:00:01.000Z',
          status: 'queued',
          stage: 'queued',
        },
        {
          sequence: 2,
          at: '2026-07-17T00:00:02.000Z',
          status: 'running',
          stage: 'resolving',
          progress: 0.08,
        },
        {
          sequence: 3,
          at: '2026-07-17T00:00:03.000Z',
          status: 'running',
          stage: 'installing',
          progress: 0.35,
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { serverLocale: 'en' },
        createElement(WorkerPrepareProgress, {
          initial: running,
          onSucceeded: () => {},
          onFailed: () => {},
        }),
      ),
    )
    assert.match(html, /worker-prepare-log/u)
    assert.doesNotMatch(html, /<progress/u)
    assert.match(html, /Resolving install plan/u)
    assert.match(html, /Installing dependencies/u)
    assert.match(html, /Preparation log/u)
  })
})
