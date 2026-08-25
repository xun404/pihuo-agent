/**
 * Independent Worker speaker in the chat timeline.
 * Visible reply is an IM bubble; assignment, activity, and approval stay process.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerRunState } from '@pihuo-agent/shared'
import { MarkdownContent } from '../MarkdownContent'
import { WorkerRunCard } from '../WorkerRunCard'
import { DiscussionSpeakerAvatar } from './GroupParticipantAvatar'
import { MessageMeta } from './MessageMeta'
import { useI18n } from '../../i18n/I18nProvider'
import { formatClockTime } from '../../lib/leader-run-meta'

export interface WorkerMessageItemProps {
  state: WorkerRunState
  taskPrompt?: string
  consecutive?: boolean
  registryIdentity?: string
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
  onQuote?: () => void
}

export const WorkerMessageItem = memo(function WorkerMessageItem({
  state,
  taskPrompt,
  consecutive = false,
  registryIdentity,
  open,
  onToggle,
  tick,
  resolving,
  onResolveApproval,
  onResetContext,
  onQuote,
}: WorkerMessageItemProps) {
  const { t, locale } = useI18n()
  const memberLabel = state.teamMemberName?.trim() || state.workerName
  const assignment = (taskPrompt || state.task || '').trim()
  const speech = state.output.trim()
  const pending = !speech && (state.status === 'running' || state.status === 'pending_approval')
  const timeLabel =
    Number.isFinite(state.startedAt) && state.startedAt > 0
      ? formatClockTime(state.startedAt, locale)
      : ''

  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])
  const copySpeech = useCallback(async () => {
    if (!speech) return
    try {
      await navigator.clipboard.writeText(speech)
      setCopied(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore clipboard failures */
    }
  }, [speech])

  return (
    <div
      className={`msg worker-speaker${consecutive ? ' is-consecutive' : ''}`}
      data-msg-role="worker"
      data-job-id={state.jobId}
    >
      <div className="msg-row">
        <DiscussionSpeakerAvatar
          participant="worker"
          role={state.role ?? 'general'}
          title={memberLabel}
          worker={{
            id: state.workerId,
            kind: state.workerKind,
            name: state.workerName,
          }}
        />
        <div className="msg-stack">
          <div className="discussion-message-identity">
            <span className="discussion-message-name">{memberLabel}</span>
            <span className="discussion-worker-kind">{t('chat.discussionWorker')}</span>
            {timeLabel ? <span className="discussion-message-time">{timeLabel}</span> : null}
          </div>
          {speech || pending ? (
            <div className="msg-bubble-row">
              <div className="msg-bubbles">
                <div className="bubble">
                  {assignment ? (
                    <div className="im-quote" title={assignment}>
                      <span className="im-quote-bar" aria-hidden />
                      <span className="im-quote-text">{assignment}</span>
                    </div>
                  ) : null}
                  {speech ? (
                    <div className="sup-text md-content">
                      <MarkdownContent>{state.output}</MarkdownContent>
                    </div>
                  ) : (
                    <div className="msg-pending" aria-label={t('chat.runPlaceholder')}>
                      <span className="pdot" />
                      <span className="pdot" />
                      <span className="pdot" />
                    </div>
                  )}
                </div>
              </div>
              {speech ? (
                <MessageMeta
                  copied={copied}
                  copyText={speech}
                  copyAriaLabel={copied ? t('chat.errorCopied') : t('chat.errorCopy')}
                  onCopy={() => void copySpeech()}
                  quoteLabel={onQuote ? t('chat.quote') : undefined}
                  onQuote={onQuote}
                />
              ) : null}
            </div>
          ) : null}
          <WorkerRunCard
            state={state}
            variant="process"
            registryIdentity={registryIdentity}
            open={open}
            onToggle={onToggle}
            tick={tick}
            resolving={resolving}
            onResolveApproval={onResolveApproval}
            onResetContext={onResetContext}
          />
        </div>
      </div>
    </div>
  )
})
