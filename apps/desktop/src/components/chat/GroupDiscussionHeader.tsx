import React from 'react'
import type { TeamMember, WorkerRegistration } from '@pihuo-agent/shared'
import { CircleAlert, Sparkles, UsersRound } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { GroupParticipantAvatar } from './GroupParticipantAvatar'

const MAX_VISIBLE_MEMBERS = 5

type ParticipantProps = {
  teamMembers: readonly TeamMember[]
  /** Optional during HMR / older callers; role glyphs remain valid without it. */
  workers?: readonly WorkerRegistration[]
}

type HeaderProps = ParticipantProps & {
  activeWorkerCount: number
  activeTaskCount: number
}

/**
 * The roster lives in the title row, exactly where a group chat normally
 * exposes its participants. It is deliberately read-only: management remains
 * available through the existing header tools rather than becoming a sidebar.
 */
export function GroupDiscussionParticipantStack({ teamMembers, workers = [] }: ParticipantProps) {
  const { t } = useI18n()
  const visibleMembers = teamMembers.slice(0, MAX_VISIBLE_MEMBERS)
  const remainingMembers = teamMembers.slice(MAX_VISIBLE_MEMBERS)
  const workerById = new Map(workers.map((worker) => [worker.id, worker]))
  const memberNames = [t('chat.discussionLeader'), ...teamMembers.map((member) => member.name)]

  return (
    <div
      className="group-discussion-participants"
      aria-label={t('chat.discussionMembers', { names: memberNames.join(', ') })}
    >
      <GroupParticipantAvatar leader title={t('chat.discussionLeader')} />
      {visibleMembers.map((member) => (
        <GroupParticipantAvatar
          key={member.id}
          member={member}
          worker={workerById.get(member.workerId)}
        />
      ))}
      {remainingMembers.length > 0 && (
        <span
          className="group-member-avatar group-member-avatar-more"
          title={remainingMembers.map((member) => member.name).join(', ')}
          aria-hidden
        >
          {t('chat.discussionMemberMore', { count: remainingMembers.length })}
        </span>
      )}
    </div>
  )
}

/** Read-only group context shown directly under the conversation title. */
export function GroupDiscussionHeader({
  teamMembers,
  activeWorkerCount,
  activeTaskCount,
}: HeaderProps) {
  const { t } = useI18n()
  const summary = t('chat.discussionRoster', {
    users: '1',
    leaders: '1',
    workers: String(teamMembers.length),
    active: String(activeTaskCount),
  })

  return (
    <div
      className="group-discussion-header"
      data-group-discussion-header
      role="group"
      aria-label={summary}
    >
      <span className="group-discussion-roster">
        <UsersRound size={16} aria-hidden />
        {summary}
      </span>
      {activeWorkerCount > 0 && (
        <span className="group-discussion-live-fact">
          <span aria-hidden className="group-discussion-live-dot" />
          {t('chat.discussionActiveWorkers', { count: activeWorkerCount })}
        </span>
      )}
    </div>
  )
}

/**
 * A visual phase marker, not a second task system. The numbers are projections
 * of the existing task-list message signal and approval snapshot.
 */
export function GroupDiscussionCoordinationStrip({
  activeTaskCount,
  pendingApprovalCount,
}: {
  activeTaskCount: number
  pendingApprovalCount: number
}) {
  const { t } = useI18n()
  const approvalText =
    pendingApprovalCount > 0
      ? t('chat.discussionPendingApprovals', { count: pendingApprovalCount })
      : t('chat.discussionNoPendingApprovals')

  return (
    <div className="group-discussion-coordination" data-group-discussion-coordination>
      <div className="group-discussion-coordination-main">
        <span className="group-discussion-coordination-icon" aria-hidden>
          <Sparkles size={16} />
        </span>
        <strong>{t('chat.discussionCoordinationTitle')}</strong>
        <span>{t('chat.discussionCoordinationSummary', { count: activeTaskCount })}</span>
      </div>
      <span
        className={`group-discussion-coordination-status${
          pendingApprovalCount > 0 ? ' is-approval' : ''
        }`}
      >
        {pendingApprovalCount > 0 && <CircleAlert size={14} aria-hidden />}
        {approvalText}
      </span>
    </div>
  )
}
