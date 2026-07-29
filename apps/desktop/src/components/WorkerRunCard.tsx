import React, { memo, useCallback, useState } from 'react'
import type {
  WorkerRunState,
  WorkerKind,
  WorkerRole,
  ApprovalItem,
  AcpToolKind,
} from '@swarmdesk-agent/shared'
import { MarkdownContent } from './MarkdownContent'
import { ApprovalActions } from './ApprovalActions'
import { resolveWorkerBrand, WorkerBrandLogo } from './Icons'
import { formatElapsedSeconds } from '../lib/format-elapsed'
import { shortModelId } from '../lib/leader-run-meta'
import { useI18n } from '../i18n/I18nProvider'
import { useCollapsible } from './chat/useCollapsible'

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const KIND_LABELS: Record<WorkerKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  custom: 'Custom',
}

const TOOL_KIND_LABELS: Record<AcpToolKind, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Execute',
  think: 'Think',
  fetch: 'Fetch',
  switch_mode: 'Switch Mode',
  other: 'Other',
}

const STATUS_LABELS: Record<WorkerRunState['status'], { zh: string; en: string }> = {
  running: { zh: 'running', en: 'running' },
  pending_approval: { zh: 'needs approval', en: 'needs approval' },
  completed: { zh: 'completed', en: 'completed' },
  failed: { zh: 'failed', en: 'failed' },
  cancelled: { zh: 'cancelled', en: 'cancelled' },
  timed_out: { zh: 'timed out', en: 'timed out' },
}

const ROLE_LABELS: Record<WorkerRole, string> = {
  plan: 'plan',
  coder: 'coder',
  review: 'review',
  test: 'test',
  research: 'research',
  general: 'general',
}

interface Props {
  state: WorkerRunState
  open?: boolean
  onToggle?: (open: boolean) => void
  tick?: number
  resolving?: Record<string, boolean>
  onResolveApproval?: (
    approvalId: string,
    optionId: string | undefined,
    decision: 'allow' | 'deny' | 'cancel',
    surface: 'chat' | 'panel',
  ) => void
  onResetContext?: (jobId: string) => void
  registryIdentity?: string
  /**
   * When this card represents a merged dispatchWorkerTool call, the task prompt
   * from the tool input is rendered as the first body section ("提示词").
   * Absent for standalone worker cards.
   */
  taskPrompt?: string
}

function formatLocations(locations: ApprovalItem['locations']): string | null {
  if (!locations || locations.length === 0) return null
  return locations
    .map((loc) => {
      if (loc.filePath && loc.line != null) {
        return `${loc.filePath}:${loc.line}`
      }
      if (loc.filePath) return loc.filePath
      if (loc.description) return loc.description
      return null
    })
    .filter(Boolean)
    .join(', ')
}

function kindClass(kind?: WorkerKind | string, name?: string): string {
  return resolveWorkerBrand(kind, name)
}

/**
 * Wireframe «对话+Worker»：worker-card 嵌在 Leader 气泡流中。
 * 结构 1:1 → worker-card / head(logo·name·role·status) / body / approval-row
 */
export const WorkerRunCard = memo(function WorkerRunCard({
  state,
  open,
  onToggle,
  tick,
  resolving = {},
  onResolveApproval,
  onResetContext,
  registryIdentity,
  taskPrompt,
}: Props) {
  const { t } = useI18n()
  const [internalOpen, setInternalOpen] = useState(
    state.status === 'running' || state.status === 'pending_approval',
  )
  const isOpen = open !== undefined ? open : internalOpen
  const status = state.status
  const isTerminal = status !== 'running' && status !== 'pending_approval'
  const isRunning = status === 'running' || status === 'pending_approval'
  const isPendingApproval = status === 'pending_approval'

  // Prefer durable startedAt → lastDeltaAt (finished). Snapshot re-sync fixes 0ms seed spans.
  const startMs = Number.isFinite(state.startedAt) ? state.startedAt : undefined
  const endMs = isTerminal
    ? Number.isFinite(state.lastDeltaAt)
      ? state.lastDeltaAt
      : undefined
    : tick
      ? Date.now()
      : Number.isFinite(state.lastDeltaAt)
        ? state.lastDeltaAt
        : Date.now()
  const durationSec =
    startMs != null && endMs != null && endMs >= startMs ? (endMs - startMs) / 1000 : 0
  const showDuration = isRunning || (isTerminal && durationSec > 0)
  const label =
    state.workerKind === 'custom'
      ? state.workerName
      : (KIND_LABELS[state.workerKind] ?? state.workerName)
  const statusText = STATUS_LABELS[status]?.zh ?? status
  const approval = state.pendingApproval ?? null
  const publicError = state.recoveryError ?? state.error

  const handleToggle = useCallback(() => {
    if (onToggle) {
      onToggle(!isOpen)
    } else {
      setInternalOpen(!isOpen)
    }
  }, [isOpen, onToggle])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleToggle()
      }
    },
    [handleToggle],
  )

  const { shouldRender, contentRef } = useCollapsible({
    open: isOpen,
    keepMounted: isRunning || !!publicError || isPendingApproval,
  })

  const statusClass =
    status === 'pending_approval' || status === 'failed' || status === 'timed_out'
      ? 'pending'
      : status === 'running'
        ? ''
        : status === 'completed'
          ? 'done'
          : ''

  return (
    <div className={`worker-card worker-card-${status}${isOpen ? ' is-open' : ''}`}>
      <div
        className="worker-card-head"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
      >
        {/* 图标槽：worker-logo ↔ chevron 交叉淡入（对齐工具/思考的 .tr-icon-slot 模式）
            折叠态显 logo，hover 时 logo 淡出 + chevron 淡入，展开态 chevron 旋转 90°。*/}
        <span className="worker-icon-slot" aria-hidden>
          <span
            className={`worker-logo ${kindClass(state.workerKind, state.workerName)}`}
            title={label}
          >
            <WorkerBrandLogo kind={state.workerKind} name={state.workerName} size={10} />
          </span>
          <span className="worker-chevron">
            <ChevronIcon />
          </span>
        </span>
        <span className="name">
          {label}
          {isRunning && (
            <span className="busy-dots" aria-hidden>
              <span className="d" />
              <span className="d" />
              <span className="d" />
            </span>
          )}
        </span>
        {state.model && (
          <span className="model mono" title={state.model.trim()}>
            {shortModelId(state.model)}
          </span>
        )}
        {state.reasoning && (
          <span className="model mono reasoning-tag" title={state.reasoning.trim()}>
            {state.reasoning}
          </span>
        )}
        {/* 角色 pill（node-cap 样式）——持久化在 WorkerJob.role，不随 session 设置变化 */}
        {state.role && (
          <span className="node-cap role-cap" data-role={state.role}>
            {ROLE_LABELS[state.role] ?? state.role}
          </span>
        )}
        <span className={`status${statusClass ? ` ${statusClass}` : ''}`}>
          {statusText}
          {showDuration ? ` · ${formatElapsedSeconds(durationSec)}` : ''}
        </span>
      </div>

      {shouldRender && (
        <div ref={contentRef} aria-hidden={!isOpen} className="worker-card-collapse">
          <div
            className="node-body-inner"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            }}
          >
            {/* .line 事件流（线稿 node-body-inner .line 1:1）
            数据诚实映射：task=派发任务行，approval=审批行，error=失败行，output=完成行。
            thinking / 子工具调用历史无数据源，不伪造。*/}
            {taskPrompt && (
              <div className="line">
                <span className="mk" aria-hidden>
                  ▸
                </span>
                <span className="tx">{taskPrompt}</span>
              </div>
            )}
            {isPendingApproval && approval && (
              <div className="line">
                <span className="mk" aria-hidden>
                  ▸
                </span>
                <span className="tx">
                  {approval.toolKind
                    ? `${TOOL_KIND_LABELS[approval.toolKind] ?? approval.toolKind} · `
                    : ''}
                  {approval.title}
                  {approval.pathOrTarget ? ` · ${approval.pathOrTarget}` : ''}
                  {approval.locations && approval.locations.length > 0
                    ? ` · ${formatLocations(approval.locations)}`
                    : ''}
                </span>
              </div>
            )}
            {publicError && (
              <div className="line">
                <span className="mk err" aria-hidden>
                  ✗
                </span>
                <span className="tx">
                  {publicError}
                  {state.errorCode === 'WORKER_AUTH_REQUIRED' && (
                    <>
                      <span className="worker-card-auth-hint">
                        {t('workers.runAuthHint', {
                          name: state.workerName,
                          identity: registryIdentity ?? state.workerId ?? state.workerName,
                        })}
                      </span>
                      <button
                        type="button"
                        className="worker-card-auth-btn"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent('swarmdesk-agent:open-settings', {
                              detail: {
                                tab: 'workers',
                                workerId: state.workerId,
                                workerName: state.workerName,
                              },
                            }),
                          )
                        }}
                      >
                        {t('workers.runAuthenticate')}
                      </button>
                    </>
                  )}
                  {state.recoveryError && state.canResetAcpContext && onResetContext && (
                    <button
                      type="button"
                      className="worker-card-auth-btn"
                      onClick={() => onResetContext(state.jobId)}
                    >
                      {t('workers.runRestartContext')}
                    </button>
                  )}
                </span>
              </div>
            )}
            {/* 完成态：渲染最终回复。长回复用 markdown（块结构），短回复用单行 ✓。*/}
            {state.output && isTerminal && status === 'completed' && (
              <div className="line ok worker-reply">
                <span className="mk" aria-hidden>
                  ✓
                </span>
                <span className="tx">
                  <MarkdownContent>{state.output}</MarkdownContent>
                </span>
              </div>
            )}
            {state.output && !isTerminal && (
              <div className="line worker-reply">
                <span className="mk" aria-hidden>
                  ▸
                </span>
                <span className="tx">
                  <MarkdownContent>{state.output}</MarkdownContent>
                </span>
              </div>
            )}
            {/* 运行中无输出：显示运行提示行 */}
            {isRunning && !state.output && !publicError && !isPendingApproval && (
              <div className="line">
                <span className="mk" aria-hidden>
                  ▸
                </span>
                <span className="tx">{t('chat.runningShort')}</span>
              </div>
            )}
            {/* 已完成但无输出 */}
            {status === 'completed' && !state.output && (
              <div className="line ok">
                <span className="mk" aria-hidden>
                  ✓
                </span>
                <span className="tx">{t('workers.runNoOutput')}</span>
              </div>
            )}
            {state.truncated && (
              <div className="line">
                <span className="mk" aria-hidden>
                  …
                </span>
                <span className="tx">{t('workers.runTruncated')}</span>
              </div>
            )}

            {isPendingApproval && approval && onResolveApproval && (
              <div className="approval-row">
                <ApprovalActions
                  approval={approval}
                  surface="chat"
                  resolving={resolving}
                  onResolve={onResolveApproval}
                  variant="wireframe"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
