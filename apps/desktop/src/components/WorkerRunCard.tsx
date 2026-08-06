import React, { memo, useCallback, useState } from 'react'
import type {
  WorkerRunState,
  WorkerKind,
  WorkerRole,
  ApprovalItem,
  AcpToolKind,
} from '@swarmdesk-agent/shared'
import { sortPendingApprovals } from '@swarmdesk-agent/shared'
import { MarkdownContent } from './MarkdownContent'
import { ApprovalActions } from './ApprovalActions'
import { resolveWorkerBrand, WorkerBrandLogo } from './Icons'
import { formatElapsedSeconds } from '../lib/format-elapsed'
import { shortModelId } from '../lib/leader-run-meta'
import { useI18n } from '../i18n/I18nProvider'
import { useStickScrollBottom } from '../lib/use-stick-scroll-bottom'
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
   * from the tool input is rendered as the first body section ("Input").
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

type WorkerActionKind = 'input' | 'approval' | 'error' | 'output' | 'thought' | 'tool' | 'plan'

function WorkerActionSection({
  kind,
  label,
  marker,
  children,
}: {
  kind: WorkerActionKind
  label: string
  marker: string
  children: React.ReactNode
}) {
  const toolBlockKind =
    kind === 'error' ? 'error' : kind === 'output' || kind === 'thought' ? 'output' : 'input'
  return (
    <section className={`worker-action-section worker-action-${kind}`}>
      <div className="worker-action-label">{label}</div>
      <div className={`tool-row-block tool-row-block-${toolBlockKind} worker-action-block`}>
        <span className="tool-row-block-marker" aria-hidden>
          {marker}
        </span>
        <div className="tool-row-block-content worker-action-content">{children}</div>
      </div>
    </section>
  )
}

function toolStatusMarker(status?: string): string {
  if (status === 'completed') return '✓'
  if (status === 'failed') return '✗'
  if (status === 'in_progress') return '…'
  return '·'
}

/**
 * Worker process row embedded in the Leader flow.
 * The worker-run root deliberately differs from Settings' worker-card class.
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
  const workerLabel =
    state.workerKind === 'custom'
      ? state.workerName
      : (KIND_LABELS[state.workerKind] ?? state.workerName)
  const memberLabel = state.teamMemberName?.trim() || state.workerName || workerLabel
  const statusText = STATUS_LABELS[status]?.zh ?? status
  const pendingApprovals = sortPendingApprovals(
    Array.isArray(state.pendingApprovals)
      ? state.pendingApprovals
      : state.pendingApproval
        ? [state.pendingApproval]
        : [],
  )
  const publicError = state.recoveryError ?? state.error
  const hasPublicError = Boolean(publicError || state.errorCode === 'RUNTIME_RESTARTED')

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
    keepMounted: isRunning || hasPublicError || isPendingApproval,
  })
  const bodyScrollRef = useStickScrollBottom(
    isOpen && (isRunning || isPendingApproval),
    `${state.output?.length ?? 0}:${state.task?.length ?? 0}:${publicError?.length ?? 0}:${state.errorCode ?? ''}`,
  )

  const statusClass =
    status === 'pending_approval' || status === 'failed' || status === 'timed_out'
      ? 'pending'
      : status === 'running'
        ? ''
        : status === 'completed'
          ? 'done'
          : ''

  return (
    <div className={`worker-run worker-run-${status}${isOpen ? ' is-open' : ''}`}>
      <div
        className="worker-card-head process-row-summary"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
      >
        {/* Icon slot: logo ↔ chevron cross-fade (same pattern as tool/thinking .tr-icon-slot).
            Collapsed shows logo; hover fades logo out and chevron in; open rotates chevron. */}
        <span className="worker-icon-slot process-icon-slot" aria-hidden>
          <span
            className={`worker-logo process-icon-type ${kindClass(state.workerKind, state.workerName)}`}
            title={state.workerName || workerLabel}
          >
            <WorkerBrandLogo
              kind={state.workerKind}
              name={state.workerName}
              size={10}
              workerId={state.workerId}
            />
          </span>
          <span className="worker-chevron process-icon-chevron">
            <ChevronIcon />
          </span>
        </span>
        <span className="name">
          {memberLabel}
          {isRunning && (
            <span className="busy-dots" aria-hidden>
              <span className="d" />
              <span className="d" />
              <span className="d" />
            </span>
          )}
        </span>
        {state.role && (
          <span className="node-cap role-cap" data-role={state.role}>
            {ROLE_LABELS[state.role] ?? state.role}
          </span>
        )}
        {(state.model || state.reasoning) && (
          <span className="worker-card-config mono">
            {state.model && (
              <span className="model" title={state.model.trim()}>
                {shortModelId(state.model)}
              </span>
            )}
            {state.model && state.reasoning && (
              <span className="worker-card-config-separator">·</span>
            )}
            {state.reasoning && (
              <span className="model reasoning-tag" title={state.reasoning.trim()}>
                {state.reasoning}
              </span>
            )}
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
            ref={bodyScrollRef}
            className="node-body-inner process-collapse-body"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            }}
          >
            {/* Input: taskPrompt from dispatch merge, or state.task from started/job hydrate.
                Shown while running — do not wait for terminal output. */}
            {(taskPrompt || state.task) && (
              <WorkerActionSection kind="input" label={t('workers.runInput')} marker="$">
                {taskPrompt || state.task}
              </WorkerActionSection>
            )}
            {Boolean(state.thought?.trim()) && (
              <WorkerActionSection kind="thought" label={t('workers.runThought')} marker="…">
                <div className="worker-action-thought">{state.thought}</div>
              </WorkerActionSection>
            )}
            {Array.isArray(state.planEntries) && state.planEntries.length > 0 && (
              <WorkerActionSection kind="plan" label={t('workers.runPlan')} marker="≡">
                <ul className="worker-action-plan-list">
                  {state.planEntries.map((entry, index) => (
                    <li key={`${index}-${entry.content.slice(0, 24)}`}>
                      {entry.status ? `[${entry.status}] ` : ''}
                      {entry.content}
                    </li>
                  ))}
                </ul>
              </WorkerActionSection>
            )}
            {Array.isArray(state.toolCalls) && state.toolCalls.length > 0 && (
              <WorkerActionSection kind="tool" label={t('workers.runTools')} marker="⚙">
                <div className="worker-action-tool-list">
                  {state.toolCalls.map((tool) => (
                    <div className="worker-action-tool-item" key={tool.toolCallId}>
                      <div className="worker-action-tool-title">
                        <span className="worker-action-tool-status" aria-hidden>
                          {toolStatusMarker(tool.status)}
                        </span>
                        {tool.kind
                          ? `${TOOL_KIND_LABELS[tool.kind] ?? tool.kind} · `
                          : ''}
                        {tool.title}
                        {tool.status ? ` · ${tool.status}` : ''}
                      </div>
                      {(tool.detail ||
                        (tool.locations && tool.locations.length > 0)) && (
                        <div className="worker-action-tool-detail">
                          {tool.locations && tool.locations.length > 0
                            ? formatLocations(tool.locations)
                            : null}
                          {tool.locations && tool.locations.length > 0 && tool.detail
                            ? ' · '
                            : null}
                          {tool.detail}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </WorkerActionSection>
            )}
            {isPendingApproval && pendingApprovals.length > 0 && (
              <WorkerActionSection kind="approval" label={t('workers.runApproval')} marker="!">
                {pendingApprovals.map((approval) => (
                  <div className="worker-action-approval-item" key={approval.id}>
                    <div className="worker-action-approval-detail">
                      {approval.toolKind
                        ? `${TOOL_KIND_LABELS[approval.toolKind] ?? approval.toolKind} · `
                        : ''}
                      {approval.title}
                      {approval.pathOrTarget ? ` · ${approval.pathOrTarget}` : ''}
                      {approval.locations && approval.locations.length > 0
                        ? ` · ${formatLocations(approval.locations)}`
                        : ''}
                    </div>
                    {!onResolveApproval &&
                      (!approval.locations || approval.locations.length === 0) && (
                        <div className="approval-scope-hint">{t('approvals.unknownScope')}</div>
                      )}
                    {onResolveApproval && (
                      <div className="approval-row worker-action-approval-controls">
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
                ))}
              </WorkerActionSection>
            )}
            {hasPublicError && (
              <WorkerActionSection kind="error" label={t('workers.runError')} marker="✗">
                <div>
                  {state.errorCode === 'RUNTIME_RESTARTED' ? (
                    <>
                      <code>RUNTIME_RESTARTED</code>
                      <span className="worker-card-runtime-hint">
                        {t('workers.runRuntimeRestarted')}
                      </span>
                    </>
                  ) : (
                    publicError
                  )}
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
                </div>
              </WorkerActionSection>
            )}
            {state.output && (
              <WorkerActionSection
                kind="output"
                label={t('workers.runOutput')}
                marker={status === 'completed' ? '✓' : '›'}
              >
                <div className="worker-action-markdown">
                  <MarkdownContent>{state.output}</MarkdownContent>
                </div>
              </WorkerActionSection>
            )}
            {/* Running with no activity yet: keep a short live hint line. */}
            {isRunning &&
              !state.output &&
              !state.thought?.trim() &&
              !(state.toolCalls && state.toolCalls.length > 0) &&
              !(state.planEntries && state.planEntries.length > 0) &&
              !publicError &&
              !isPendingApproval && (
              <div className="line">
                <span className="mk" aria-hidden>
                  ▸
                </span>
                <span className="tx">{t('chat.runningShort')}</span>
              </div>
            )}
            {/* Completed with empty output. */}
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
          </div>
        </div>
      )}
    </div>
  )
})
