import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateApprovalNotifications,
  evaluateSessionNotifications,
} from './notification-watcher.js'
import { DEFAULT_NOTIFICATION_SETTINGS, type Session } from '@swarmdesk-agent/shared'

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's1',
  projectId: 'p1',
  title: 'My Session',
  status: 'idle',
  mode: 'build',
  activeWorkerIds: [],
  memoryThreadId: 'm1',
  approvalPolicy: 'manual',
  permissionMode: 'default',
  teamRevision: 0,
  lastFinishedAt: '2026-08-08T10:00:00.000Z',
  lastErrorAt: undefined,
  lastReadAt: '2026-08-08T09:00:00.000Z',
  createdAt: '2026-08-08T08:00:00.000Z',
  updatedAt: '2026-08-08T10:00:00.000Z',
  ...overrides,
})

test('completion fires when lastFinishedAt is newer than watermark and read', () => {
  const { decisions, nextWatermarks } = evaluateSessionNotifications({
    sessions: [session()],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true },
    focused: false,
    lastNotifiedAt: {},
  })
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0]?.kind, 'completion')
  assert.equal(decisions[0]?.sessionId, 's1')
  assert.equal(nextWatermarks.s1, '2026-08-08T10:00:00.000Z')
})

test('hidden-only mode suppresses while focused and keeps the watermark', () => {
  const { decisions, nextWatermarks } = evaluateSessionNotifications({
    sessions: [session()],
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    focused: true,
    lastNotifiedAt: {},
  })
  assert.equal(decisions.length, 0)
  assert.equal(nextWatermarks.s1, undefined)
})

test('always mode notifies even while focused', () => {
  const { decisions } = evaluateSessionNotifications({
    sessions: [session()],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, mode: 'always' },
    focused: true,
    lastNotifiedAt: {},
  })
  assert.equal(decisions.length, 1)
})

test('already-notified sessions do not re-fire', () => {
  const { decisions } = evaluateSessionNotifications({
    sessions: [session()],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true },
    focused: false,
    lastNotifiedAt: { s1: '2026-08-08T10:00:00.000Z' },
  })
  assert.equal(decisions.length, 0)
})

test('read-after-event suppresses notification', () => {
  const { decisions } = evaluateSessionNotifications({
    sessions: [session({ lastReadAt: '2026-08-08T10:30:00.000Z' })],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true },
    focused: false,
    lastNotifiedAt: {},
  })
  assert.equal(decisions.length, 0)
})

test('onCompletion=false suppresses completion but error still fires', () => {
  const { decisions } = evaluateSessionNotifications({
    sessions: [session(), session({ id: 's2', title: 'Err', lastFinishedAt: undefined, lastErrorAt: '2026-08-08T11:00:00.000Z' })],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, onCompletion: false },
    focused: false,
    lastNotifiedAt: {},
  })
  assert.deepEqual(decisions.map((d) => d.kind), ['error'])
})

test('approval fires once per pending approval id', () => {
  const approval = {
    id: 'a1',
    status: 'pending' as const,
    title: '执行命令',
    workerName: 'writer',
    sessionId: 's1',
    createdAt: '2026-08-08T10:00:00.000Z',
    options: [],
    source: 'acp' as const,
  }
  const { decisions, nextNotifiedIds } = evaluateApprovalNotifications({
    approvals: [approval],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true },
    focused: false,
    notifiedApprovalIds: new Set(),
  })
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0]?.kind, 'approval')
  assert.deepEqual(nextNotifiedIds, ['a1'])
})

test('approval suppressed while focused in hidden-only and not marked notified', () => {
  const approval = {
    id: 'a2',
    status: 'pending' as const,
    title: 't',
    createdAt: '2026-08-08T10:00:00.000Z',
    options: [],
    source: 'acp' as const,
  }
  const { decisions, nextNotifiedIds } = evaluateApprovalNotifications({
    approvals: [approval],
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    focused: true,
    notifiedApprovalIds: new Set(),
  })
  assert.equal(decisions.length, 0)
  assert.deepEqual(nextNotifiedIds, [])
})

test('watermark advances to the later of completion and error in the same round', () => {
  const s = session({ lastFinishedAt: '2026-08-08T11:00:00.000Z', lastErrorAt: '2026-08-08T10:30:00.000Z' })
  const first = evaluateSessionNotifications({
    sessions: [s],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true },
    focused: false,
    lastNotifiedAt: {},
  })
  assert.deepEqual(first.decisions.map((d) => d.kind), ['completion', 'error'])
  assert.equal(first.nextWatermarks.s1, '2026-08-08T11:00:00.000Z')
  const second = evaluateSessionNotifications({
    sessions: [s],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true },
    focused: false,
    lastNotifiedAt: first.nextWatermarks,
  })
  assert.equal(second.decisions.length, 0)
})

test('approval suppressed when onApproval is disabled, fires when enabled', () => {
  const approval = {
    id: 'a3',
    status: 'pending' as const,
    title: 't',
    createdAt: '2026-08-08T10:00:00.000Z',
    options: [],
    source: 'acp' as const,
  }
  const off = evaluateApprovalNotifications({
    approvals: [approval],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, onApproval: false },
    focused: false,
    notifiedApprovalIds: new Set(),
  })
  assert.equal(off.decisions.length, 0)
  assert.deepEqual(off.nextNotifiedIds, [])
  const on = evaluateApprovalNotifications({
    approvals: [approval],
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true },
    focused: false,
    notifiedApprovalIds: new Set(),
  })
  assert.equal(on.decisions.length, 1)
  assert.deepEqual(on.nextNotifiedIds, ['a3'])
})
