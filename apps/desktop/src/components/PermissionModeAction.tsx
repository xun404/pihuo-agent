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
}

export function PermissionModeAction({
  mode,
  onChange,
  disabled = false,
  saving = false,
}: PermissionModeActionProps) {
  const { t } = useI18n()
  const [pending, setPending] = useState(false)
  const busy = saving || pending
  const auto = mode === 'auto'
  const label = t(auto ? 'permissions.autoOn' : 'permissions.autoOff')
  const tooltipTitle = t(auto ? 'permissions.autoTitle' : 'permissions.defaultTitle')
  const tooltipDescription = t(
    auto ? 'permissions.autoDescription' : 'permissions.defaultDescription',
  )
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
      </span>
    </span>
  )
}
