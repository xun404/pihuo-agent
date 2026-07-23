import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRemoteRuntimeDispatchPort } from './remote-runtime-dispatch-port.js'
import { writeRuntimeDiscovery } from './runtime-discovery.js'
import type { WorkerJob } from '@swarmdesk-agent/shared'

function openJob(id: string): WorkerJob {
  return {
    id,
    sessionId: 'session',
    projectId: 'project',
    workerId: 'worker',
    workerName: 'Worker',
    task: 'work',
    cwd: '/tmp',
    status: 'running',
    approvalPolicy: 'manual',
    createdAt: new Date().toISOString(),
    source: 'leader',
  }
}

describe('RemoteRuntimeDispatchPort reconnect semantics', () => {
  const originalTimeout = process.env.WORKER_JOB_TIMEOUT_MS

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.WORKER_JOB_TIMEOUT_MS
    else process.env.WORKER_JOB_TIMEOUT_MS = originalTimeout
  })

  it('resets the event cursor before requesting a replacement owner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remote-owner-epoch-'))
    const discoveryPath = join(dir, 'runtime.json')
    const firstStart = '2026-07-15T10:00:00.000Z'
    const secondStart = '2026-07-15T10:01:00.000Z'
    writeRuntimeDiscovery({ path: discoveryPath, port: 4111, pid: 1001, startedAt: firstStart })
    const cursors: number[] = []
    let eventCalls = 0
    const encoder = new TextEncoder()
    const remote = createRemoteRuntimeDispatchPort({
      discoveryPath,
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) {
          cursors.push(Number(url.searchParams.get('afterSequence')))
          eventCalls += 1
          if (eventCalls === 1) return new Response(new ReadableStream({ start: (c) => c.close() }))
          const line =
            JSON.stringify({
              ownerEpoch: `${1002}:${secondStart}`,
              emitSequence: 1,
              event: {
                type: 'completed',
                jobId: 'job-owner',
                output: 'done',
                truncated: false,
                workerName: 'Worker',
              },
            }) + '\n'
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(line))
                controller.close()
              },
            }),
          )
        }
        if (url.pathname.includes('/jobs/')) {
          writeRuntimeDiscovery({
            path: discoveryPath,
            port: 4111,
            pid: 1002,
            startedAt: secondStart,
          })
          return Response.json({ job: openJob('job-owner') })
        }
        throw new Error(`unexpected ${url.pathname}`)
      },
    })
    try {
      for await (const event of remote.events('job-owner', undefined, { afterSequence: 50 })) {
        if (event.type === 'completed') break
      }
      assert.deepEqual(cursors.slice(0, 2), [50, 0])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws a public interruption error instead of silently ending for an open job', async () => {
    process.env.WORKER_JOB_TIMEOUT_MS = '5'
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4111',
      token: 'test-token',
      eventTimeoutMs: 5,
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) {
          return new Response(new ReadableStream({ start: (controller) => controller.close() }))
        }
        return Response.json({ job: openJob('job-open') })
      },
    })

    await assert.rejects(
      async () => {
        for await (const _event of remote.events('job-open')) {
          // no terminal event is ever produced
        }
      },
      (error: unknown) => {
        const typed = error as { code?: string; message?: string }
        assert.equal(typed.code, 'RUNTIME_EVENT_STREAM_INTERRUPTED')
        assert.match(typed.message ?? '', /job-open/)
        return true
      },
    )
  })

  it('bounds a half-open response body and cancels its reader before reporting interruption', async () => {
    process.env.WORKER_JOB_TIMEOUT_MS = '20'
    let bodyCancelled = false
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4111',
      token: 'test-token',
      eventTimeoutMs: 20,
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) {
          return new Response(
            new ReadableStream({
              cancel() {
                bodyCancelled = true
                return new Promise<void>(() => {})
              },
            }),
          )
        }
        return Response.json({ job: openJob('job-half-open') })
      },
    })

    await assert.rejects(
      async () => {
        for await (const _event of remote.events('job-half-open')) {
          // body intentionally never produces bytes or EOF
        }
      },
      (error: unknown) => (error as { code?: string }).code === 'RUNTIME_EVENT_STREAM_INTERRUPTED',
    )
    assert.equal(bodyCancelled, true)
  })

  it('reconciles a durable terminal result when a half-open stream reaches its deadline', async () => {
    process.env.WORKER_JOB_TIMEOUT_MS = '20'
    const terminalJob = {
      ...openJob('job-durable-terminal'),
      status: 'succeeded' as const,
      output: 'durable',
    }
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4111',
      token: 'test-token',
      eventTimeoutMs: 20,
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) {
          return new Response(new ReadableStream({}))
        }
        return Response.json({ job: terminalJob })
      },
    })

    const events = []
    for await (const event of remote.events(terminalJob.id)) events.push(event)
    assert.equal(events.length, 1)
    assert.equal(events[0]?.type, 'completed')
    assert.equal(events[0]?.type === 'completed' ? events[0].output : undefined, 'durable')
  })

  it('preserves a durable terminal errorCode when the event stream must be synthesized', async () => {
    process.env.WORKER_JOB_TIMEOUT_MS = '20'
    const terminalJob = {
      ...openJob('job-durable-auth-failure'),
      status: 'failed' as const,
      error: 'Authentication required',
      errorCode: 'WORKER_AUTH_REQUIRED',
    }
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4111',
      token: 'test-token',
      eventTimeoutMs: 20,
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) return new Response(new ReadableStream({}))
        return Response.json({ job: terminalJob })
      },
    })
    const events = []
    for await (const event of remote.events(terminalJob.id)) events.push(event)
    assert.equal(events[0]?.type, 'failed')
    assert.equal(events[0]?.errorCode, 'WORKER_AUTH_REQUIRED')
  })

  it('bounds a fetch that never resolves and then reconciles durable state', async () => {
    process.env.WORKER_JOB_TIMEOUT_MS = '20'
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4111',
      token: 'test-token',
      eventTimeoutMs: 20,
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) return await new Promise<Response>(() => {})
        return Response.json({ job: openJob('job-fetch-hang') })
      },
    })

    await assert.rejects(
      async () => {
        for await (const _event of remote.events('job-fetch-hang')) {
          // no-op
        }
      },
      (error: unknown) => (error as { code?: string }).code === 'RUNTIME_EVENT_STREAM_INTERRUPTED',
    )
  })

  it('does not mask a durable-state auth failure after an event-stream 404', async () => {
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4111',
      token: 'test-token',
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) return new Response(null, { status: 404 })
        return new Response(null, { status: 401 })
      },
    })

    await assert.rejects(
      async () => {
        for await (const _event of remote.events('job-auth')) {
          // no-op
        }
      },
      (error: unknown) => (error as { code?: string }).code === 'RUNTIME_AUTH_FAILED',
    )
  })

  it('does not mask auth failure when a successful stream closes before terminal', async () => {
    const abort = new AbortController()
    const safety = setTimeout(() => abort.abort(), 250)
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4111',
      token: 'test-token',
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) {
          return new Response(new ReadableStream({ start: (controller) => controller.close() }))
        }
        return new Response(null, { status: 401 })
      },
    })

    try {
      await assert.rejects(
        async () => {
          for await (const _event of remote.events('job-stream-auth', abort.signal)) {
            // no-op
          }
        },
        (error: unknown) => (error as { code?: string }).code === 'RUNTIME_AUTH_FAILED',
      )
    } finally {
      clearTimeout(safety)
    }
  })

  it('reports a missing durable job precisely after an event-stream 404', async () => {
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4111',
      token: 'test-token',
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        if (url.pathname.includes('/events/')) return new Response(null, { status: 404 })
        return Response.json({ job: null })
      },
    })

    await assert.rejects(
      async () => {
        for await (const _event of remote.events('job-missing')) {
          // no-op
        }
      },
      (error: unknown) => {
        const typed = error as { code?: string; message?: string }
        assert.equal(typed.code, 'RUNTIME_EVENT_STREAM_INTERRUPTED')
        assert.match(typed.message ?? '', /durable status: missing/)
        return true
      },
    )
  })
})
