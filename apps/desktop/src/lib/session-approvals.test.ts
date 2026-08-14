import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ApprovalItem } from '@pihuo-agent/shared'
import { approvalsForSession } from './session-approvals.js'

function approval(id: string, opts: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id,
    status: 'pending',
    title: id,
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    source: 'acp',
    createdAt: '2026-08-04T00:00:00.000Z',
    ...opts,
  }
}

describe('approvalsForSession', () => {
  it('keeps direct Session rows and legacy Job-linked rows while excluding other Sessions', () => {
    const rows = [
      approval('direct', { sessionId: 's1' }),
      approval('legacy-job', { sessionId: null, jobId: 'j1' }),
      approval('other-session', { sessionId: 's2', jobId: 'j2' }),
      approval('unlinked', { sessionId: null, jobId: 'missing' }),
    ]

    assert.deepEqual(
      approvalsForSession(
        rows,
        [
          { id: 'j1', sessionId: 's1' },
          { id: 'j2', sessionId: 's2' },
        ],
        's1',
      ).map((row) => row.id),
      ['direct', 'legacy-job'],
    )
  })
})
