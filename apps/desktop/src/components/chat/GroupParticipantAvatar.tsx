import React from 'react'
import type { TeamMember, WorkerRegistration, WorkerRole } from '@pihuo-agent/shared'
import {
  Code2,
  Crown,
  FlaskConical,
  Map,
  SearchCheck,
  Sparkles,
  Telescope,
  UserRound,
} from 'lucide-react'
import { resolveWorkerIconAgentId, WorkerBrandLogo } from '../Icons'

type WorkerIdentity = Pick<WorkerRegistration, 'kind' | 'name'> &
  Partial<Pick<WorkerRegistration, 'id' | 'iconPath' | 'iconAgentId' | 'source'>>

type Props =
  | {
      leader: true
      title: string
    }
  | {
      leader?: false
      member: TeamMember
      worker?: WorkerRegistration
    }

function RoleIcon({ role }: { role: WorkerRole }) {
  switch (role) {
    case 'plan':
      return <Map size={14} />
    case 'coder':
      return <Code2 size={14} />
    case 'review':
      return <SearchCheck size={14} />
    case 'test':
      return <FlaskConical size={14} />
    case 'research':
      return <Telescope size={14} />
    case 'general':
      return <Sparkles size={14} />
  }
}

function AgentBadge({ worker, className }: { worker: WorkerIdentity; className: string }) {
  return (
    <span className={className} data-agent-kind={worker.kind}>
      <WorkerBrandLogo
        kind={worker.kind}
        name={worker.name}
        size={8}
        workerId={worker.id}
        hasIcon={worker.id ? Boolean(worker.iconPath) : false}
        iconAgentId={resolveWorkerIconAgentId(worker)}
      />
    </span>
  )
}

export function DiscussionSpeakerAvatar({
  participant,
  title,
  role = 'general',
  worker,
}: {
  participant: 'user' | 'leader' | 'worker'
  title: string
  role?: WorkerRole
  worker?: WorkerIdentity
}) {
  return (
    <span
      className={`discussion-speaker-avatar is-${participant}`}
      data-discussion-speaker={participant}
      data-role={participant === 'worker' ? role : undefined}
      title={title}
      aria-hidden
    >
      <span className="discussion-speaker-role-icon">
        {participant === 'leader' ? (
          <Crown size={13} />
        ) : participant === 'user' ? (
          <UserRound size={13} />
        ) : (
          <RoleIcon role={role} />
        )}
      </span>
      {participant === 'worker' && worker && (
        <AgentBadge worker={worker} className="discussion-message-agent-badge" />
      )}
    </span>
  )
}

/**
 * Compact group-member avatar: the large glyph expresses the Team role, while
 * the lower-right badge identifies the actual Worker registered to execute it.
 * Both are a read-only projection of the existing snapshot.
 */
export function GroupParticipantAvatar(props: Props) {
  if (props.leader) {
    return (
      <span
        className="group-member-avatar group-member-avatar-leader"
        data-group-participant="leader"
        title={props.title}
        aria-hidden
      >
        <span className="group-member-role-icon">
          <Crown size={14} />
        </span>
      </span>
    )
  }

  const { member, worker } = props
  return (
    <span
      className="group-member-avatar"
      data-group-participant="member"
      data-role={member.roleType}
      title={member.name}
      aria-hidden
    >
      <span className="group-member-role-icon">
        <RoleIcon role={member.roleType} />
      </span>
      {worker && <AgentBadge worker={worker} className="group-member-agent-badge" />}
    </span>
  )
}
