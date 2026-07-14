import { memo, useState } from 'react'
import type { WorkerRunState, WorkerKind, WorkerRole } from '@router-agents/shared'
import { MarkdownContent } from './MarkdownContent'

const KIND_LABELS: Record<WorkerKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  custom: 'Custom',
}

const STATUS_LABELS: Record<
  WorkerRunState['status'],
  { zh: string; en: string }
> = {
  running: { zh: '运行中', en: 'Running' },
  completed: { zh: '已完成', en: 'Completed' },
  failed: { zh: '失败', en: 'Failed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
  timed_out: { zh: '已超时', en: 'Timed Out' },
}

const ROLE_LABELS: Record<WorkerRole, string> = {
  plan: '规划',
  coder: '编码',
  review: '审查',
  test: '测试',
  research: '调研',
  general: '通用',
}

interface Props {
  state: WorkerRunState
  open?: boolean
  onToggle?: (open: boolean) => void
  tick?: number
}

export const WorkerRunCard = memo(function WorkerRunCard({
  state,
  open,
  onToggle,
  tick,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(state.status === 'running')
  const isOpen = open !== undefined ? open : internalOpen
  const status = state.status
  const isTerminal = status !== 'running'
  const isRunning = status === 'running'

  const now = tick ? Date.now() : undefined
  const durationMs =
    ((isTerminal ? state.lastDeltaAt : (now ?? state.lastDeltaAt)) ?? Date.now()) -
    (state.startedAt ?? Date.now())
  const durationSec = Math.max(0, durationMs / 1000)

  const label = state.workerKind === 'custom' ? state.workerName : (KIND_LABELS[state.workerKind] ?? state.workerName)
  const statusText = STATUS_LABELS[status]?.zh ?? status

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (onToggle) {
      onToggle(e.currentTarget.open)
    } else {
      setInternalOpen(e.currentTarget.open)
    }
  }

  return (
    <details
      className={`chat-worker-run chat-worker-run-${status}`}
      open={isOpen}
      onToggle={handleToggle}
    >
      <summary className="chat-worker-run-header">
        <span className="chat-meta-chevron" aria-hidden>
          ▸
        </span>
        <span className="chat-worker-run-name">{label}</span>
        {state.role && (
          <span className="badge badge-gray chat-worker-run-role">
            {ROLE_LABELS[state.role] ?? state.role}
          </span>
        )}
        {state.model && (
          <span className="chat-worker-run-model">{state.model}</span>
        )}
        <span className={`chat-worker-run-status chat-worker-run-status-${status}`}>
          {statusText}
        </span>
        <span className="chat-worker-run-duration">
          {durationSec.toFixed(1)}s
        </span>
      </summary>
      <div className="chat-worker-run-body">
        {state.error && (
          <div className="chat-worker-run-error">{state.error}</div>
        )}
        {state.output ? (
          isTerminal && status === 'completed' ? (
            <MarkdownContent>{state.output}</MarkdownContent>
          ) : (
            <pre className="chat-worker-run-pre">{state.output}</pre>
          )
        ) : isRunning ? (
          <div className="chat-worker-run-pending">…</div>
        ) : status === 'completed' ? (
          <div className="chat-worker-run-pending">Completed (no output)</div>
        ) : null}
        {state.truncated && (
          <div className="chat-worker-run-truncated">输出已截断</div>
        )}
      </div>
    </details>
  )
})
