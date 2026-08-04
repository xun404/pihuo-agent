import React, { useId, useState } from 'react'
import { ShieldCheck, ShieldUser } from 'lucide-react'
import type { SessionPermissionMode } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'

export function nextPermissionMode(mode: SessionPermissionMode): SessionPermissionMode {
  return mode === 'auto' ? 'default' : 'auto'
}

export interface PermissionModeActionProps {
  mode: SessionPermissionMode
  onChange: (mode: SessionPermissionMode) => void | Promise<void>
  disabled?: boolean
  saving?: boolean
  /** Number of pending approvals in the current Session, when available. */
  pendingApprovalCount?: number
  /** Number of approvals that failed the last auto reconciliation. */
  failureCount?: number
  /** The shield is session-scoped in Chat and draft-scoped on Home. */
  scope?: 'session' | 'draft'
}

export function PermissionModeAction({
  mode,
  onChange,
  disabled = false,
  saving = false,
  pendingApprovalCount = 0,
  failureCount = 0,
  scope = 'session',
}: PermissionModeActionProps) {
  const { t } = useI18n()
  const [pending, setPending] = useState(false)
  const busy = saving || pending
  const auto = mode === 'auto'
  const label = t(auto ? 'permissions.autoOn' : 'permissions.autoOff')
  const tooltipTitle = t(
    scope === 'session'
      ? auto
        ? 'permissions.sessionAutoTitle'
        : 'permissions.sessionDefaultTitle'
      : auto
        ? 'permissions.draftAutoTitle'
        : 'permissions.draftDefaultTitle',
  )
  const tooltipDescription = t(
    scope === 'session'
      ? auto
        ? 'permissions.sessionAutoDescription'
        : 'permissions.sessionDefaultDescription'
      : auto
        ? 'permissions.draftAutoDescription'
        : 'permissions.draftDefaultDescription',
  )
  const countHints = [
    pendingApprovalCount > 0
      ? t('permissions.pendingCount', { count: pendingApprovalCount })
      : null,
    failureCount > 0 ? t('permissions.failureCount', { count: failureCount }) : null,
  ].filter((value): value is string => Boolean(value))
  const tooltipId = useId()
  const Icon = auto ? ShieldCheck : ShieldUser

  return (
    <span className="permission-mode-control">
      <button
        type="button"
        className={`permission-mode-action${auto ? ' is-auto' : ''}`}
        aria-label={label}
        aria-describedby={tooltipId}
        aria-pressed={auto}
        disabled={disabled || busy}
        onClick={() => {
          if (disabled || busy) return
          setPending(true)
          Promise.resolve(onChange(nextPermissionMode(mode)))
            .catch(() => {})
            .finally(() => setPending(false))
        }}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
      <span id={tooltipId} className="permission-mode-tooltip" role="tooltip">
        <span className="permission-mode-tooltip-title">{tooltipTitle}</span>
        <span className="permission-mode-tooltip-description">{tooltipDescription}</span>
        {countHints.length > 0 && (
          <span className="permission-mode-tooltip-feedback">{countHints.join(' · ')}</span>
        )}
      </span>
    </span>
  )
}
