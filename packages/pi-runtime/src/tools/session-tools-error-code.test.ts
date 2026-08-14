import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WorkerJob, WorkerRunEvent } from '@pihuo-agent/shared'
import { applyTerminalEventToJob, jobToTerminalEvent, jobToToolResult } from './session-tools.js'

function failedJob(): WorkerJob {
  return {
    id: 'job_error_code',
    sessionId: 'session_1',
    projectId: 'project_1',
    threadId: 'thread_1',
    workerId: 'worker_1',
    workerName: 'Registry Agent',
    role: 'general',
    task: 'run',
    cwd: '/tmp',
    status: 'failed',
    approvalPolicy: 'manual',
    source: 'leader',
    createdAt: '2026-07-17T00:00:00.000Z',
    finishedAt: '2026-07-17T00:00:01.000Z',
    error: 'Authentication required',
    errorCode: 'WORKER_AUTH_REQUIRED',
  }
}

describe('session tool errorCode pipeline', () => {
  it('preserves terminal event code into Job and tool result', () => {
    const queued = { ...failedJob(), status: 'running' as const, errorCode: undefined }
    const event: WorkerRunEvent = {
      type: 'failed',
      jobId: queued.id,
      output: '',
      error: 'Authentication required',
      errorCode: 'WORKER_AUTH_REQUIRED',
      truncated: false,
    }
    const terminal = applyTerminalEventToJob(queued, event)
    assert.equal(terminal.errorCode, 'WORKER_AUTH_REQUIRED')
    assert.equal(jobToToolResult(terminal).errorCode, 'WORKER_AUTH_REQUIRED')
  })

  it('preserves durable Job code when synthesizing a terminal event', () => {
    const event = jobToTerminalEvent(failedJob())
    assert.equal(event.type, 'failed')
    assert.equal(event.errorCode, 'WORKER_AUTH_REQUIRED')
  })
})
