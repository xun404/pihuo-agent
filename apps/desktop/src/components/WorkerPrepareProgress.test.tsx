import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import type { RegistryOperationSnapshot, RegistryPrepareResult } from '../lib/api.js'
import { I18nProvider } from '../i18n/I18nProvider.js'
import {
  WorkerPrepareProgress,
  pollRegistryOperationUntilTerminal,
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
  })
})
