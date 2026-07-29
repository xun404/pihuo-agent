import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalStore } from '@swarmdesk-agent/core'
import type { WorkerJob, WorkerRunEvent } from '@swarmdesk-agent/shared'
import { isTerminalWorkerEvent } from '@swarmdesk-agent/shared'
import {
  createLocalRuntimeDispatchPort,
  validateRuntimeApprovalResolveInput,
  type RuntimeDispatchPort,
  type TrustedDispatchInput,
} from './runtime-dispatch-port.js'
import { WorkerEventEmitter } from './worker-events.js'

function makeJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: 'job_1',
    sessionId: 'sess_1',
    projectId: 'proj_1',
    threadId: 'thread_1',
    workerId: 'w1',
    workerName: 'Worker',
    role: 'coder',
    task: 'do work',
    cwd: '/tmp',
    status: 'queued',
    approvalPolicy: 'manual',
    createdAt: new Date().toISOString(),
    source: 'leader',
    ...overrides,
  }
}

describe('LocalRuntimeDispatchPort contract', () => {
  let dir: string
  let store: LocalStore
  let emitter: WorkerEventEmitter
  let jobs: Map<string, WorkerJob>
  let port: RuntimeDispatchPort
  let enqueued: TrustedDispatchInput[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dispatch-port-'))
    store = new LocalStore(join(dir, 'state.json'))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'proj') })
    store.createSession({ projectId: project.id, title: 'S1' })
    const sessions = store.listSessions(project.id)
    // ensure known memoryThreadId
    const session = sessions[0]!
    // recreate with fixed thread via direct state is hard; use actual memoryThreadId
    emitter = new WorkerEventEmitter({ terminalTtlMs: 5_000 })
    jobs = new Map()
    enqueued = []

    port = createLocalRuntimeDispatchPort({
      store,
      scheduler: {
        enqueue: async (req) => {
          enqueued.push(req as never)
          const job = makeJob({
            id: `job_${jobs.size + 1}`,
            sessionId: req.sessionId ?? 'sess',
            projectId: req.projectId ?? 'proj',
            threadId: req.threadId,
            task: req.task,
            cwd: req.cwd ?? '/tmp',
            role: req.role,
            status: 'queued',
          })
          jobs.set(job.id, job)
          if (req.onEvent) {
            emitter.subscribe(job.id, req.onEvent)
          }
          // Emit immediately (including terminal) — late events() must still replay journal
          const running: WorkerJob = {
            ...job,
            status: 'running',
            startedAt: new Date().toISOString(),
          }
          jobs.set(job.id, running)
          emitter.emit({
            type: 'started',
            jobId: job.id,
            workerId: job.workerId,
            workerName: job.workerName,
            workerKind: 'opencode',
            role: job.role,
            reusedSession: false,
          })
          emitter.emit({ type: 'delta', jobId: job.id, sequence: 1, delta: 'hi' })
          const done: WorkerJob = {
            ...running,
            status: 'succeeded',
            finishedAt: new Date().toISOString(),
            output: 'hi',
          }
          jobs.set(job.id, done)
          emitter.emit({
            type: 'completed',
            jobId: job.id,
            output: 'hi',
            truncated: false,
            workerName: job.workerName,
            role: job.role,
          })
          return { job }
        },
        cancel: async (jobId) => {
          const job = jobs.get(jobId)
          if (!job) throw new Error(`Job not found: ${jobId}`)
          const cancelled: WorkerJob = {
            ...job,
            status: 'cancelled',
            finishedAt: new Date().toISOString(),
          }
          jobs.set(jobId, cancelled)
          emitter.emit({
            type: 'cancelled',
            jobId,
            error: 'Cancel requested',
            truncated: false,
            workerName: job.workerName,
            role: job.role,
          })
          return cancelled
        },
        resolveApproval: (approvalId, decision, options) => {
          void approvalId
          void decision
          void options
          return {
            id: approvalId,
            status: decision === 'allow' ? 'allowed' : decision === 'deny' ? 'denied' : 'cancelled',
            title: 't',
            options: [],
            source: 'acp',
            createdAt: new Date().toISOString(),
            sessionId: null,
          } as never
        },
        waitForJob: async (jobId) => {
          for (let i = 0; i < 50; i++) {
            const job = jobs.get(jobId)
            if (
              job &&
              job.status !== 'queued' &&
              job.status !== 'running' &&
              job.status !== 'pending_approval'
            ) {
              return job
            }
            await new Promise((r) => setTimeout(r, 5))
          }
          throw new Error('timeout')
        },
      },
      events: emitter,
    })
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('resolveSessionContext exact memoryThreadId match only', async () => {
    const sessions = store.listSessions()
    assert.ok(sessions.length >= 1)
    const session = sessions[0]!
    const project = store.listProjects().find((p) => p.id === session.projectId)!

    const hit = await port.resolveSessionContext(session.memoryThreadId)
    assert.ok(hit)
    assert.equal(hit!.routerSessionId, session.id)
    assert.equal(hit!.routerProjectId, session.projectId)
    assert.equal(hit!.memoryThreadId, session.memoryThreadId)
    assert.equal(hit!.routerProjectRoot, project.rootPath)

    const miss = await port.resolveSessionContext('nonexistent-thread-id')
    assert.equal(miss, null)

    // prefix / partial must not match
    const partial = await port.resolveSessionContext(session.memoryThreadId.slice(0, 4))
    assert.equal(partial, null)
  })

  it('dispatch produces job', async () => {
    const session = store.listSessions()[0]!
    const project = store.listProjects().find((p) => p.id === session.projectId)!
    const job = await port.dispatch({
      context: {
        routerSessionId: session.id,
        routerProjectId: project.id,
        routerProjectRoot: project.rootPath,
        memoryThreadId: session.memoryThreadId,
      },
      task: 'implement feature',
      role: 'coder',
    })
    assert.ok(job.id)
    assert.equal(job.task, 'implement feature')
    assert.equal(enqueued.length, 1)
  })

  it('manages Chat Team members and dispatches by member identity', async () => {
    const session = store.listSessions()[0]!
    const context = await port.resolveSessionContext(session.memoryThreadId)
    assert.ok(context)
    store.upsertWorker({
      id: 'worker-role',
      name: 'Role Worker',
      kind: 'custom',
      command: 'agent-acp',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: '',
      health: 'healthy',
    })

    const created = await port.createTeamMember!({
      context: context!,
      input: {
        workerId: 'worker-role',
        name: 'Implementer',
        roleType: 'coder',
        instructions: 'Implement carefully.',
      },
    })
    assert.equal(created.chatSessionId, session.id)
    assert.deepEqual(await port.listTeamMembers!(context!), [created])

    const updated = await port.updateTeamMember!({
      context: context!,
      teamMemberId: created.id,
      patch: { model: 'role-model', expectedRevision: 1 },
    })
    assert.equal(updated.revision, 2)

    await port.dispatch({
      context: context!,
      teamMemberId: created.id,
      task: 'implement feature',
    })
    assert.equal(enqueued.at(-1)?.teamMemberId, created.id)

    const openJob = store.createJob(
      makeJob({
        id: 'job_role_open',
        sessionId: session.id,
        projectId: session.projectId,
        teamMemberId: created.id,
      }),
    )
    await assert.rejects(
      () =>
        port.resetTeamMemberSession!({
          context: context!,
          teamMemberId: created.id,
        }),
      /ROLE_CONTEXT_HAS_OPEN_JOBS/u,
    )
    store.updateJob(openJob.id, {
      status: 'succeeded',
      finishedAt: new Date().toISOString(),
    })
    assert.deepEqual(
      await port.resetTeamMemberSession!({
        context: context!,
        teamMemberId: created.id,
      }),
      { deleted: false },
    )

    const archived = await port.archiveTeamMember!({
      context: context!,
      teamMemberId: created.id,
      expectedRevision: 2,
    })
    assert.ok(archived.archivedAt)
  })

  it('events eventually terminal', async () => {
    const session = store.listSessions()[0]!
    const project = store.listProjects().find((p) => p.id === session.projectId)!
    const job = await port.dispatch({
      context: {
        routerSessionId: session.id,
        routerProjectId: project.id,
        routerProjectRoot: project.rootPath,
        memoryThreadId: session.memoryThreadId,
      },
      task: 'stream me',
    })

    const received: WorkerRunEvent[] = []
    for await (const event of port.events(job.id)) {
      received.push(event)
      if (isTerminalWorkerEvent(event)) break
    }
    assert.ok(received.some((e) => e.type === 'started'))
    assert.ok(received.some((e) => e.type === 'delta'))
    const terminals = received.filter((e) => isTerminalWorkerEvent(e))
    assert.equal(terminals.length, 1)
    assert.equal(terminals[0]!.type, 'completed')
  })

  it('cancel works', async () => {
    // Slow job path: override enqueue to not auto-complete
    const slowPort = createLocalRuntimeDispatchPort({
      store,
      scheduler: {
        enqueue: async (req) => {
          const job = makeJob({
            id: 'job_slow',
            sessionId: req.sessionId ?? 's',
            projectId: req.projectId ?? 'p',
            threadId: req.threadId,
            task: req.task,
            status: 'running',
          })
          jobs.set(job.id, job)
          if (req.onEvent) emitter.subscribe(job.id, req.onEvent)
          queueMicrotask(() => {
            emitter.emit({
              type: 'started',
              jobId: job.id,
              workerId: job.workerId,
              workerName: job.workerName,
              workerKind: 'claude',
              reusedSession: false,
            })
          })
          return { job }
        },
        cancel: async (jobId) => {
          const job = jobs.get(jobId) ?? makeJob({ id: jobId, status: 'running' })
          const cancelled = {
            ...job,
            status: 'cancelled' as const,
            finishedAt: new Date().toISOString(),
          }
          jobs.set(jobId, cancelled)
          emitter.emit({
            type: 'cancelled',
            jobId,
            error: 'Cancel requested',
            truncated: false,
          })
          return cancelled
        },
        resolveApproval: () => {
          throw new Error('not used')
        },
        waitForJob: async (jobId) => jobs.get(jobId) ?? makeJob({ id: jobId }),
      },
      events: emitter,
    })

    const session = store.listSessions()[0]!
    const project = store.listProjects().find((p) => p.id === session.projectId)!
    const job = await slowPort.dispatch({
      context: {
        routerSessionId: session.id,
        routerProjectId: project.id,
        memoryThreadId: session.memoryThreadId,
      },
      task: 'long',
    })
    await slowPort.cancel(job.id)
    assert.equal(jobs.get(job.id)?.status, 'cancelled')
  })

  it('auth token not in error messages', async () => {
    const secretToken = 'super-secret-bearer-token-abcdef'
    const { createRemoteRuntimeDispatchPort } = await import('./remote-runtime-dispatch-port.js')
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:9',
      token: secretToken,
      fetchImpl: async () => {
        throw new Error(`connect failed Authorization: Bearer ${secretToken}`)
      },
    })
    await assert.rejects(
      () =>
        remote.dispatch({
          context: {
            routerSessionId: 's',
            routerProjectId: 'p',
            memoryThreadId: 't',
          },
          task: 'x',
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        assert.ok(!msg.includes(secretToken), `token leaked in: ${msg}`)
        assert.ok(
          msg.includes('SWARMDESK_AGENT_RUNTIME_UNAVAILABLE') || msg.includes('unavailable'),
          `expected public error, got: ${msg}`,
        )
        return true
      },
    )
  })

  it('Remote events parses NDJSON stream through terminal', async () => {
    const { createRemoteRuntimeDispatchPort } = await import('./remote-runtime-dispatch-port.js')
    const lines = [
      JSON.stringify({
        type: 'started',
        jobId: 'job_ndjson',
        workerId: 'w1',
        workerName: 'W',
        workerKind: 'opencode',
        reusedSession: false,
      }),
      JSON.stringify({ type: 'delta', jobId: 'job_ndjson', sequence: 1, delta: 'hi' }),
      JSON.stringify({
        type: 'completed',
        jobId: 'job_ndjson',
        output: 'hi',
        truncated: false,
        workerName: 'W',
      }),
      '',
    ]
    const encoder = new TextEncoder()
    let i = 0
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4112',
      token: 'test-token',
      fetchImpl: async (input, init) => {
        const url = String(input)
        assert.match(url, /\/internal\/runtime\/events\/job_ndjson/)
        assert.equal(
          init?.headers && (init.headers as Record<string, string>).Authorization,
          'Bearer test-token',
        )
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i < lines.length) {
              controller.enqueue(encoder.encode(lines[i]! + (i < lines.length - 1 ? '\n' : '')))
              i += 1
            } else {
              controller.close()
            }
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        })
      },
    })

    const received: WorkerRunEvent[] = []
    for await (const event of remote.events('job_ndjson')) {
      received.push(event)
      if (isTerminalWorkerEvent(event)) break
    }
    assert.equal(received.length, 3)
    assert.equal(received[0]!.type, 'started')
    assert.equal(received[1]!.type, 'delta')
    assert.equal(received[2]!.type, 'completed')
  })

  it('Remote cancel posts to internal cancel API', async () => {
    const { createRemoteRuntimeDispatchPort } = await import('./remote-runtime-dispatch-port.js')
    let posted: { url: string; body: unknown } | undefined
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4112',
      token: 'tok',
      fetchImpl: async (input, init) => {
        posted = {
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    await remote.cancel('job_cancel_1')
    assert.ok(posted)
    assert.match(posted!.url, /\/internal\/runtime\/cancel$/)
    assert.deepEqual(posted!.body, { jobId: 'job_cancel_1' })
  })

  it('Remote resolveSessionContext calls session-by-thread', async () => {
    const { createRemoteRuntimeDispatchPort } = await import('./remote-runtime-dispatch-port.js')
    let urlSeen = ''
    const remote = createRemoteRuntimeDispatchPort({
      baseUrl: 'http://127.0.0.1:4112',
      token: 'tok',
      fetchImpl: async (input) => {
        urlSeen = String(input)
        return new Response(
          JSON.stringify({
            context: {
              routerSessionId: 's1',
              routerProjectId: 'p1',
              routerProjectRoot: '/r',
              memoryThreadId: 'thread x',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
    })
    const ctx = await remote.resolveSessionContext('thread x')
    assert.match(urlSeen, /memoryThreadId=thread%20x/)
    assert.equal(ctx?.routerSessionId, 's1')
    assert.equal(ctx?.memoryThreadId, 'thread x')
  })

  it('Local events wraps worker event bus through terminal without waitForJob', async () => {
    let waitForJobCalled = false
    const bus = new WorkerEventEmitter({ terminalTtlMs: 5_000 })
    const local = createLocalRuntimeDispatchPort({
      store,
      scheduler: {
        enqueue: async (req) => {
          const job = makeJob({
            id: 'job_bus_only',
            task: req.task,
            sessionId: req.sessionId ?? 's',
            projectId: req.projectId ?? 'p',
            threadId: req.threadId,
            status: 'queued',
          })
          // Emit only via shared bus — no onEvent callback path.
          setTimeout(() => {
            bus.emit({
              type: 'started',
              jobId: job.id,
              workerId: job.workerId,
              workerName: job.workerName,
              workerKind: 'codex',
              role: job.role,
              reusedSession: false,
            })
            bus.emit({ type: 'delta', jobId: job.id, sequence: 1, delta: 'via-bus' })
            bus.emit({
              type: 'completed',
              jobId: job.id,
              output: 'via-bus',
              truncated: false,
              workerName: job.workerName,
              role: job.role,
            })
          }, 5)
          return { job }
        },
        cancel: async () => {
          throw new Error('not used')
        },
        resolveApproval: () => {
          throw new Error('not used')
        },
        waitForJob: async () => {
          waitForJobCalled = true
          throw new Error('waitForJob must not be used for events wait')
        },
      },
      events: bus,
    })

    const session = store.listSessions()[0]!
    const project = store.listProjects().find((p) => p.id === session.projectId)!
    const job = await local.dispatch({
      context: {
        routerSessionId: session.id,
        routerProjectId: project.id,
        routerProjectRoot: project.rootPath,
        memoryThreadId: session.memoryThreadId,
      },
      task: 'bus only',
      wait: false,
    })

    const received: WorkerRunEvent[] = []
    for await (const event of local.events(job.id)) {
      received.push(event)
      if (isTerminalWorkerEvent(event)) break
    }

    assert.equal(waitForJobCalled, false)
    assert.ok(received.some((e) => e.type === 'started'))
    assert.ok(received.some((e) => e.type === 'delta'))
    assert.equal(received.filter((e) => isTerminalWorkerEvent(e)).length, 1)
    assert.equal(received.find((e) => isTerminalWorkerEvent(e))!.type, 'completed')
  })

  it('open queued job with empty journal keeps events() open until live terminal', async () => {
    const bus = new WorkerEventEmitter({ terminalTtlMs: 5_000 })
    const durable = new Map<string, WorkerJob>()
    const jobId = 'job_open_keep'
    durable.set(jobId, makeJob({ id: jobId, status: 'queued' }))
    const local = createLocalRuntimeDispatchPort({
      store,
      scheduler: {
        enqueue: async () => ({ job: durable.get(jobId)! }),
        cancel: async () => durable.get(jobId)!,
        resolveApproval: () => {
          throw new Error('not used')
        },
        waitForJob: async () => {
          throw new Error('not used')
        },
        getJob: (id) => durable.get(id),
      },
      events: bus,
    })

    const received: WorkerRunEvent[] = []
    let done = false
    const iter = (async () => {
      for await (const event of local.events(jobId)) {
        received.push(event)
        if (isTerminalWorkerEvent(event)) {
          done = true
          break
        }
      }
    })()

    // Give the consumer a moment — must not finish with empty journal + open job
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(done, false, 'must not finish while job is still queued')
    assert.equal(received.length, 0)

    durable.set(jobId, {
      ...durable.get(jobId)!,
      status: 'running',
      startedAt: new Date().toISOString(),
    })
    bus.emit({
      type: 'started',
      jobId,
      workerId: 'w1',
      workerName: 'Worker',
      workerKind: 'codex',
      role: 'coder',
      reusedSession: false,
    })
    bus.emit({ type: 'delta', jobId, sequence: 1, delta: 'hi' })
    durable.set(jobId, {
      ...durable.get(jobId)!,
      status: 'succeeded',
      output: 'hi',
      finishedAt: new Date().toISOString(),
    })
    bus.emit({
      type: 'completed',
      jobId,
      output: 'hi',
      truncated: false,
      workerName: 'Worker',
      role: 'coder',
    })

    await Promise.race([
      iter,
      new Promise((_, rej) => setTimeout(() => rej(new Error('events hung')), 2000)),
    ])
    assert.equal(done, true)
    assert.ok(received.some((e) => e.type === 'started'))
    assert.ok(received.some((e) => e.type === 'delta'))
    assert.equal(received.at(-1)?.type, 'completed')
  })

  it('preserves errorCode when synthesizing from a durable terminal Job', async () => {
    const bus = new WorkerEventEmitter({ terminalTtlMs: 5_000 })
    const job = makeJob({
      id: 'job_synthetic_auth',
      status: 'failed',
      error: 'Authentication required',
      errorCode: 'WORKER_AUTH_REQUIRED',
      finishedAt: new Date().toISOString(),
    })
    const local = createLocalRuntimeDispatchPort({
      store,
      scheduler: {
        enqueue: async () => ({ job }),
        cancel: async () => job,
        resolveApproval: () => {
          throw new Error('not used')
        },
        waitForJob: async () => job,
        getJob: () => job,
      },
      events: bus,
    })
    const events: WorkerRunEvent[] = []
    for await (const event of local.events(job.id)) events.push(event)
    assert.equal(events[0]?.type, 'failed')
    assert.equal(events[0]?.errorCode, 'WORKER_AUTH_REQUIRED')
  })

  it('afterSequence at latest cursor keeps connection for open job (no premature EOF)', async () => {
    const bus = new WorkerEventEmitter({ terminalTtlMs: 5_000 })
    const jobId = 'job_cursor_open'
    const durable = new Map<string, WorkerJob>([[jobId, makeJob({ id: jobId, status: 'running' })]])
    bus.emit({
      type: 'started',
      jobId,
      workerId: 'w1',
      workerName: 'Worker',
      workerKind: 'codex',
      role: 'coder',
      reusedSession: false,
    })
    const journal = bus.getJournal(jobId, 0)
    const latest = journal[journal.length - 1]!.seq

    const local = createLocalRuntimeDispatchPort({
      store,
      scheduler: {
        enqueue: async () => ({ job: durable.get(jobId)! }),
        cancel: async () => durable.get(jobId)!,
        resolveApproval: () => {
          throw new Error('not used')
        },
        waitForJob: async () => {
          throw new Error('not used')
        },
        getJob: (id) => durable.get(id),
      },
      events: bus,
    })

    const received: WorkerRunEvent[] = []
    let finishedEarly = false
    const iter = (async () => {
      for await (const event of local.events(jobId, undefined, { afterSequence: latest })) {
        received.push(event)
        if (isTerminalWorkerEvent(event)) break
      }
      finishedEarly = true
    })()

    await new Promise((r) => setTimeout(r, 30))
    assert.equal(finishedEarly, false, 'afterSequence==latest must still wait for open job')
    assert.equal(received.length, 0)

    durable.set(jobId, {
      ...durable.get(jobId)!,
      status: 'succeeded',
      output: 'done',
      finishedAt: new Date().toISOString(),
    })
    bus.emit({
      type: 'completed',
      jobId,
      output: 'done',
      truncated: false,
      workerName: 'Worker',
      role: 'coder',
    })
    await Promise.race([
      iter,
      new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 2000)),
    ])
    assert.equal(received.length, 1)
    assert.equal(received[0]!.type, 'completed')
  })
})

describe('internal runtime approval input', () => {
  it('accepts cancel without an option id', () => {
    assert.deepEqual(
      validateRuntimeApprovalResolveInput({ approvalId: 'approval-1', decision: 'cancel' }),
      {
        ok: true,
        value: {
          approvalId: 'approval-1',
          decision: 'cancel',
          surface: 'panel',
        },
      },
    )
  })

  it('requires an option for allow/deny and rejects one for cancel', () => {
    assert.equal(
      validateRuntimeApprovalResolveInput({ approvalId: 'a', decision: 'allow' }).ok,
      false,
    )
    assert.equal(
      validateRuntimeApprovalResolveInput({
        approvalId: 'a',
        decision: 'cancel',
        optionId: 'allow-once',
      }).ok,
      false,
    )
  })
})

describe('dispatchTeamMemberTool via RuntimeDispatchPort', () => {
  const originalJobTimeout = process.env.WORKER_JOB_TIMEOUT_MS

  afterEach(async () => {
    const { resetRuntimeDispatchPortForTests } = await import('./runtime-dispatch-port.js')
    const { setWorkerObservationTimeoutForTests } = await import('./tools/session-tools.js')
    resetRuntimeDispatchPortForTests()
    setWorkerObservationTimeoutForTests(undefined)
    if (originalJobTimeout === undefined) delete process.env.WORKER_JOB_TIMEOUT_MS
    else process.env.WORKER_JOB_TIMEOUT_MS = originalJobTimeout
  })

  it('wait=true completes from port.events without local scheduler.waitForJob', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool } = await import('./tools/session-tools.js')
    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-tool-'))

    const job = makeJob({
      id: 'job_remote_style',
      status: 'queued',
      task: 'remote wait',
      workerName: 'RemoteWorker',
      role: 'coder',
      cwd: projectRoot,
    })

    let eventsCalls = 0
    let waitForJobStyle = false
    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async () => job,
      events: async function* (jobId: string) {
        eventsCalls += 1
        assert.equal(jobId, job.id)
        yield {
          type: 'started',
          jobId,
          workerId: job.workerId,
          workerName: job.workerName,
          workerKind: 'opencode' as const,
          role: job.role,
          reusedSession: false,
        }
        yield { type: 'delta', jobId, sequence: 1, delta: 'hello' }
        yield {
          type: 'completed',
          jobId,
          output: 'hello world',
          truncated: false,
          workerName: job.workerName,
          role: job.role,
        }
      },
      cancel: async () => {},
      resolveApproval: async () => {},
    }
    // Guard: if tool still uses local scheduler.waitForJob for this unknown job id, it hangs.
    // Detect via short timeout race.
    setRuntimeDispatchPort(port)

    const ctx = {
      requestContext: {
        get(key: string) {
          const map: Record<string, string> = {
            routerSessionId: 'sess_1',
            routerProjectId: 'proj_1',
            routerProjectRoot: projectRoot,
            memoryThreadId: 'thread_1',
          }
          return map[key]
        },
      },
    }

    const resultPromise = dispatchTeamMemberTool.execute!(
      { teamMemberId: 'role_remote', task: 'remote wait', wait: true },
      ctx as never,
    )
    const timed = await Promise.race([
      resultPromise.then((r) => ({ kind: 'ok' as const, r })),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), 500),
      ),
    ])

    if (timed.kind === 'timeout') {
      waitForJobStyle = true
    }
    assert.equal(
      waitForJobStyle,
      false,
      'dispatchTeamMemberTool hung — still using scheduler.waitForJob?',
    )
    assert.ok(timed.kind === 'ok')
    if (timed.kind !== 'ok') return
    assert.equal(eventsCalls, 1, 'must consume port.events for wait=true')
    const r = timed.r as {
      ok?: boolean
      jobId?: string
      status?: string
      output?: string
      workerName?: string
    }
    assert.equal(r.ok, true)
    assert.equal(r.jobId, job.id)
    assert.equal(r.status, 'succeeded')
    assert.equal(r.output, 'hello world')
    assert.equal(r.workerName, 'RemoteWorker')
  })

  it('wait=true streaming path consumes port.events not dispatch onEvent', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool } = await import('./tools/session-tools.js')
    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-stream-'))

    const job = makeJob({
      id: 'job_stream_port',
      status: 'queued',
      task: 'stream me',
      workerName: 'StreamWorker',
      role: 'coder',
      cwd: projectRoot,
    })

    let dispatchOnEvent: unknown
    let eventsCalls = 0
    const written: unknown[] = []

    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async (input) => {
        dispatchOnEvent = input.onEvent
        return job
      },
      events: async function* (jobId: string) {
        eventsCalls += 1
        yield {
          type: 'started',
          jobId,
          workerId: job.workerId,
          workerName: job.workerName,
          workerKind: 'claude' as const,
          role: job.role,
          reusedSession: false,
        }
        yield { type: 'delta', jobId, sequence: 1, delta: 'chunk' }
        yield {
          type: 'completed',
          jobId,
          output: 'chunk done',
          truncated: false,
          workerName: job.workerName,
          role: job.role,
        }
      },
      cancel: async () => {},
      resolveApproval: async () => {},
    }
    setRuntimeDispatchPort(port)

    const ctx = {
      requestContext: {
        get(key: string) {
          const map: Record<string, string> = {
            routerSessionId: 'sess_1',
            routerProjectId: 'proj_1',
            routerProjectRoot: projectRoot,
            memoryThreadId: 'thread_1',
          }
          return map[key]
        },
      },
      writer: {
        custom: async (opts: { type: string; data: unknown }) => {
          written.push(opts)
        },
      },
    }

    const timed = await Promise.race([
      dispatchTeamMemberTool.execute!(
        { teamMemberId: 'role_stream', task: 'stream me', wait: true },
        ctx as never,
      ).then((r) => ({
        kind: 'ok' as const,
        r,
      })),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), 800),
      ),
    ])

    assert.notEqual(timed.kind, 'timeout', 'streaming wait hung on scheduler.waitForJob')
    assert.ok(timed.kind === 'ok')
    if (timed.kind !== 'ok') return
    assert.equal(dispatchOnEvent, undefined, 'must not pass local onEvent into port.dispatch')
    assert.equal(eventsCalls, 1, 'must stream via port.events')
    const r = timed.r as { ok?: boolean; status?: string; output?: string }
    assert.equal(r.ok, true)
    assert.equal(r.status, 'succeeded')
    assert.equal(r.output, 'chunk done')
    assert.ok(written.length > 0, 'writer should receive streamed events')
  })

  it('wait=true without a writer times out, aborts observation, and cancels the job', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool, setWorkerObservationTimeoutForTests } =
      await import('./tools/session-tools.js')
    setWorkerObservationTimeoutForTests(20)
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-timeout-'))
    const job = makeJob({
      id: 'job_never_terminal',
      status: 'running',
      task: 'never completes',
      cwd: projectRoot,
    })
    let observerAborted = false
    let cancelCalls = 0
    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async () => job,
      events: async function* (_jobId: string, signal?: AbortSignal) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            observerAborted = true
            resolve()
            return
          }
          signal?.addEventListener(
            'abort',
            () => {
              observerAborted = true
              resolve()
            },
            { once: true },
          )
        })
      },
      cancel: async () => {
        cancelCalls += 1
      },
      resolveApproval: async () => {},
    }
    setRuntimeDispatchPort(port)

    const result = (await dispatchTeamMemberTool.execute!(
      {
        teamMemberId: 'role_timeout',
        task: job.task,
        wait: true,
      },
      {
        requestContext: {
          get(key: string) {
            const values: Record<string, string> = {
              routerSessionId: job.sessionId,
              routerProjectId: job.projectId,
              routerProjectRoot: projectRoot,
              memoryThreadId: job.threadId!,
            }
            return values[key]
          },
        },
      } as never,
    )) as { status?: string; error?: string }

    assert.equal(result.status, 'timed_out')
    assert.match(result.error ?? '', /timed out/i)
    assert.equal(observerAborted, true)
    assert.equal(cancelCalls, 1)
  })

  it('wait=true chat abort calls port.cancel exactly once (non-streaming)', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool } = await import('./tools/session-tools.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-abort-'))
    const job = makeJob({
      id: 'job_abort_cancel',
      status: 'running',
      task: 'long running task',
      cwd: projectRoot,
    })
    const abortController = new AbortController()
    let cancelCalls = 0
    let observerAborted = false

    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async () => job,
      events: async function* (_jobId: string, signal?: AbortSignal) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            observerAborted = true
            resolve()
            return
          }
          signal?.addEventListener(
            'abort',
            () => {
              observerAborted = true
              resolve()
            },
            { once: true },
          )
        })
      },
      cancel: async () => {
        cancelCalls += 1
      },
      resolveApproval: async () => {},
    }
    setRuntimeDispatchPort(port)

    const ctx = {
      requestContext: {
        get(key: string) {
          const values: Record<string, string> = {
            routerSessionId: job.sessionId,
            routerProjectId: job.projectId,
            routerProjectRoot: projectRoot,
            memoryThreadId: job.threadId!,
          }
          return values[key]
        },
      },
      abortSignal: abortController.signal,
    }

    const p = dispatchTeamMemberTool.execute!(
      { teamMemberId: 'role_abort', task: job.task, wait: true },
      ctx as never,
    )

    abortController.abort()
    const result = (await p) as { status?: string; jobId?: string; error?: string }

    assert.equal(cancelCalls, 1, 'chat abort must call port.cancel exactly once')
    assert.equal(observerAborted, true, 'events observer must be aborted')
    assert.equal(result.status, 'failed')
    assert.equal(result.jobId, job.id)
  })

  it('wait=true chat abort does not finish before the shared cancel request settles', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool } = await import('./tools/session-tools.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-abort-wait-'))
    const job = makeJob({
      id: 'job_abort_waits_for_cancel',
      status: 'running',
      task: 'wait for cancellation delivery',
      cwd: projectRoot,
    })
    const abortController = new AbortController()
    let releaseCancel!: () => void
    const cancelSettled = new Promise<void>((resolve) => {
      releaseCancel = resolve
    })
    let cancelCalls = 0

    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async () => job,
      events: async function* (_jobId: string, signal?: AbortSignal) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      cancel: async () => {
        cancelCalls += 1
        await cancelSettled
      },
      resolveApproval: async () => {},
    }
    setRuntimeDispatchPort(port)

    const ctx = {
      requestContext: {
        get(key: string) {
          const values: Record<string, string> = {
            routerSessionId: job.sessionId,
            routerProjectId: job.projectId,
            routerProjectRoot: projectRoot,
            memoryThreadId: job.threadId!,
          }
          return values[key]
        },
      },
      abortSignal: abortController.signal,
    }

    const execution = dispatchTeamMemberTool.execute!(
      { teamMemberId: 'role_abort_wait', task: job.task, wait: true },
      ctx as never,
    )
    abortController.abort()

    const beforeCancelSettles = await Promise.race([
      execution.then(() => 'finished' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20)),
    ])
    assert.equal(beforeCancelSettles, 'pending', 'tool must await cancellation delivery')
    assert.equal(cancelCalls, 1)

    releaseCancel()
    const result = (await execution) as { status?: string; jobId?: string }
    assert.equal(result.status, 'failed')
    assert.equal(result.jobId, job.id)
    assert.equal(cancelCalls, 1, 'all cancellation paths must share one request')
  })

  it('wait=true chat abort reports one cancel delivery failure without rejecting the tool', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool } = await import('./tools/session-tools.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-abort-error-'))
    const job = makeJob({
      id: 'job_abort_cancel_error',
      status: 'running',
      task: 'report failed cancellation delivery',
      cwd: projectRoot,
    })
    const abortController = new AbortController()
    let cancelCalls = 0

    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async () => job,
      events: async function* (_jobId: string, signal?: AbortSignal) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      cancel: async () => {
        cancelCalls += 1
        throw new Error('owner unavailable')
      },
      resolveApproval: async () => {},
    }
    setRuntimeDispatchPort(port)

    const ctx = {
      requestContext: {
        get(key: string) {
          const values: Record<string, string> = {
            routerSessionId: job.sessionId,
            routerProjectId: job.projectId,
            routerProjectRoot: projectRoot,
            memoryThreadId: job.threadId!,
          }
          return values[key]
        },
      },
      abortSignal: abortController.signal,
    }

    const errors: unknown[][] = []
    const originalConsoleError = console.error
    console.error = (...args: unknown[]) => {
      errors.push(args)
    }
    try {
      const execution = dispatchTeamMemberTool.execute!(
        { teamMemberId: 'role_abort_error', task: job.task, wait: true },
        ctx as never,
      )
      abortController.abort()
      const result = (await execution) as { status?: string; jobId?: string }

      assert.equal(result.status, 'failed')
      assert.equal(result.jobId, job.id)
      assert.equal(cancelCalls, 1)
      assert.equal(errors.length, 1, 'cancel delivery failure must be reported exactly once')
      assert.match(String(errors[0]?.[0]), new RegExp(job.id))
      assert.match(String(errors[0]?.[1]), /owner unavailable/)
    } finally {
      console.error = originalConsoleError
    }
  })

  it('wait=true with pre-aborted signal cancels immediately on binding', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool } = await import('./tools/session-tools.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-preabort-'))
    const job = makeJob({
      id: 'job_pre_aborted',
      status: 'running',
      task: 'already aborted',
      cwd: projectRoot,
    })
    const abortController = new AbortController()
    abortController.abort()
    let cancelCalls = 0

    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async () => job,
      events: async function* (_jobId: string, signal?: AbortSignal) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      cancel: async () => {
        cancelCalls += 1
      },
      resolveApproval: async () => {},
    }
    setRuntimeDispatchPort(port)

    const ctx = {
      requestContext: {
        get(key: string) {
          const values: Record<string, string> = {
            routerSessionId: job.sessionId,
            routerProjectId: job.projectId,
            routerProjectRoot: projectRoot,
            memoryThreadId: job.threadId!,
          }
          return values[key]
        },
      },
      abortSignal: abortController.signal,
    }

    const result = (await dispatchTeamMemberTool.execute!(
      { teamMemberId: 'role_pre', task: job.task, wait: true },
      ctx as never,
    )) as { status?: string; jobId?: string }

    assert.equal(cancelCalls, 1, 'pre-aborted signal must trigger cancel')
    assert.equal(result.status, 'failed')
    assert.equal(result.jobId, job.id)
  })

  it('wait=false does not cancel on chat abort', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool } = await import('./tools/session-tools.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-nocancel-'))
    const job = makeJob({
      id: 'job_no_cancel',
      status: 'queued',
      task: 'fire and forget',
      cwd: projectRoot,
    })
    const abortController = new AbortController()
    let cancelCalls = 0

    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async () => job,
      events: async function* () {
        yield {
          type: 'completed',
          jobId: job.id,
          output: 'done',
          truncated: false,
          workerName: job.workerName,
          role: job.role,
        }
      },
      cancel: async () => {
        cancelCalls += 1
      },
      resolveApproval: async () => {},
    }
    setRuntimeDispatchPort(port)

    const ctx = {
      requestContext: {
        get(key: string) {
          const values: Record<string, string> = {
            routerSessionId: job.sessionId,
            routerProjectId: job.projectId,
            routerProjectRoot: projectRoot,
            memoryThreadId: job.threadId!,
          }
          return values[key]
        },
      },
      abortSignal: abortController.signal,
    }

    abortController.abort()
    const result = (await dispatchTeamMemberTool.execute!(
      { teamMemberId: 'role_async', task: job.task, wait: false },
      ctx as never,
    )) as { status?: string; jobId?: string }

    assert.equal(cancelCalls, 0, 'wait=false must not call port.cancel on abort')
    assert.equal(result.jobId, job.id)
  })

  it('wait=true streaming path abort calls cancel and returns failed', async () => {
    const { setRuntimeDispatchPort } = await import('./runtime-dispatch-port.js')
    const { dispatchTeamMemberTool } = await import('./tools/session-tools.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'dispatch-stream-abort-'))
    const job = makeJob({
      id: 'job_stream_abort',
      status: 'running',
      task: 'stream then abort',
      cwd: projectRoot,
    })
    const abortController = new AbortController()
    let cancelCalls = 0
    let observerAborted = false
    const written: unknown[] = []

    const port: RuntimeDispatchPort = {
      resolveSessionContext: async () => null,
      dispatch: async () => job,
      events: async function* (_jobId: string, signal?: AbortSignal) {
        yield {
          type: 'started',
          jobId: job.id,
          workerId: job.workerId,
          workerName: job.workerName,
          workerKind: 'opencode' as const,
          role: job.role,
          reusedSession: false,
        }
        yield { type: 'delta', jobId: job.id, sequence: 1, delta: 'partial...' }
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            observerAborted = true
            resolve()
            return
          }
          signal?.addEventListener(
            'abort',
            () => {
              observerAborted = true
              resolve()
            },
            { once: true },
          )
        })
      },
      cancel: async () => {
        cancelCalls += 1
      },
      resolveApproval: async () => {},
    }
    setRuntimeDispatchPort(port)

    const ctx = {
      requestContext: {
        get(key: string) {
          const values: Record<string, string> = {
            routerSessionId: job.sessionId,
            routerProjectId: job.projectId,
            routerProjectRoot: projectRoot,
            memoryThreadId: job.threadId!,
          }
          return values[key]
        },
      },
      abortSignal: abortController.signal,
      writer: {
        custom: async (opts: { type: string; data: unknown }) => {
          written.push(opts)
        },
      },
    }

    const p = dispatchTeamMemberTool.execute!(
      { teamMemberId: 'role_stream_abort', task: job.task, wait: true },
      ctx as never,
    )

    await new Promise((r) => setTimeout(r, 30))
    abortController.abort()
    const result = (await p) as { status?: string; jobId?: string; error?: string }

    assert.equal(cancelCalls, 1, 'streaming abort must call port.cancel exactly once')
    assert.equal(observerAborted, true)
    assert.equal(result.status, 'failed')
    assert.equal(result.jobId, job.id)
    assert.ok(written.length >= 1, 'writer should receive at least the started event')
  })
})
