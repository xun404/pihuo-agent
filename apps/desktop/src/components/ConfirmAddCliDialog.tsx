import { useState } from 'react'
import type { CustomAcpPreview } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import { Modal } from './ui/Modal'

interface Props {
  open: boolean
  preview: CustomAcpPreview | null
  onCancel: () => void
  /** User confirmed adding this CLI (always-new, or forced). */
  onConfirm: (decision: { force?: boolean; duplicateDecision?: 'add_anyway' }) => void
  /** User chose to reuse an existing worker instead of adding. */
  onReuse: (workerId: string) => void
}

type ConflictChoice = 'add_new' | string

/**
 * Confirmation dialog shown after a custom CLI is probed. Renders the ACP agent identity
 * (name/version/protocol/capabilities/auth methods/status) and adapts to four states:
 * ready (confirm), duplicate (choose add-new vs reuse), probe-failed (force), auth-required
 * (add disabled — the CLI must be logged in first).
 */
export function ConfirmAddCliDialog({ open, preview, onCancel, onConfirm, onReuse }: Props) {
  const { t } = useI18n()
  const [choice, setChoice] = useState<ConflictChoice>('add_new')

  if (!preview) return null
  const { candidate, conflicts } = preview
  const status = candidate.readiness.status

  const isAuthRequired = status === 'auth_required'
  const isProbeFailed = status === 'incompatible' || status === 'failed'
  const hasConflicts = conflicts.length > 0
  // Primary button is disabled only when the agent is unauthenticated (must log in first).
  // Probe failures can be force-added; duplicates let the user pick add-new.
  const primaryDisabled = isAuthRequired
  const reuseTarget = choice !== 'add_new' ? conflicts.find((c) => c.workerId === choice) : undefined

  const handlePrimary = () => {
    if (hasConflicts && reuseTarget) {
      onReuse(reuseTarget.workerId)
      return
    }
    onConfirm({ force: isProbeFailed, duplicateDecision: hasConflicts ? 'add_anyway' : undefined })
  }

  const primaryLabel = isProbeFailed
    ? t('workers.confirmForceAdd')
    : hasConflicts
      ? t('workers.confirmContinue')
      : t('workers.confirmAdd')

  return (
    <Modal open={open} onClose={onCancel} label={t('workers.confirmTitle')}>
      <div className="confirm-add-cli">
        <h3 className="confirm-add-cli-title">{t('workers.confirmTitle')}</h3>

        {!isProbeFailed && <p className="confirm-add-cli-subtitle">{t('workers.confirmConnected')}</p>}
        {isProbeFailed && <p className="confirm-add-cli-warn">{t('workers.confirmProbeFailed')}</p>}

        {/* Parameter card: the ACP agent identity surfaced from initialize. */}
        <div className="confirm-add-cli-card">
          <div className="confirm-add-cli-name">
            <span className="confirm-add-cli-agent">{candidate.agentName ?? '—'}</span>
            {candidate.agentVersion && (
              <span className="confirm-add-cli-version">v{candidate.agentVersion}</span>
            )}
          </div>
          <dl className="confirm-add-cli-fields">
            <div className="confirm-add-cli-field">
              <dt>{t('workers.confirmCommand')}</dt>
              <dd className="mono">
                {candidate.command} {candidate.args.join(' ')}
              </dd>
            </div>
            {candidate.protocolVersion !== undefined && (
              <div className="confirm-add-cli-field">
                <dt>{t('workers.confirmProtocol')}</dt>
                <dd>ACP {candidate.protocolVersion}</dd>
              </div>
            )}
            <div className="confirm-add-cli-field">
              <dt>{t('workers.confirmSessionCaps')}</dt>
              <dd>
                <span>load {candidate.sessionLoad ? t('workers.capYes') : t('workers.capNo')}</span>
                <span>
                  resume {candidate.sessionResume ? t('workers.capYes') : t('workers.capNo')}
                </span>
                <span>list {candidate.sessionList ? t('workers.capYes') : t('workers.capNo')}</span>
              </dd>
            </div>
            <div className="confirm-add-cli-field">
              <dt>{t('workers.confirmLogout')}</dt>
              <dd>{candidate.authLogout ? t('workers.capYes') : t('workers.capNo')}</dd>
            </div>
            {candidate.authMethods.length > 0 && (
              <div className="confirm-add-cli-field">
                <dt>{t('workers.confirmAuthMethods')}</dt>
                <dd>
                  {candidate.authMethods
                    .map((m) => `${m.name ?? m.id} (${m.type ?? 'unknown'})`)
                    .join(' · ')}
                </dd>
              </div>
            )}
            <div className="confirm-add-cli-field">
              <dt>{t('workers.confirmStatus')}</dt>
              <dd className={`confirm-add-cli-status confirm-add-cli-status-${status}`}>
                {candidate.readiness.message ?? status}
              </dd>
            </div>
          </dl>
        </div>

        {/* State 4: auth required — explain, disable add. */}
        {isAuthRequired && (
          <div className="confirm-add-cli-authrequired">
            <p className="confirm-add-cli-warn">{t('workers.confirmAuthRequired')}</p>
            <p className="confirm-add-cli-hint">{t('workers.confirmAuthRequiredHint')}</p>
          </div>
        )}

        {/* State 3: probe failed — allow force add. */}
        {isProbeFailed && <p className="confirm-add-cli-hint">{t('workers.confirmProbeFailedHint')}</p>}

        {/* State 2: duplicate — let user choose add-new vs reuse. */}
        {hasConflicts && !isAuthRequired && (
          <div className="confirm-add-cli-conflicts">
            <p className="confirm-add-cli-warn">{t('workers.confirmDuplicateWarning')}</p>
            <label className="confirm-add-cli-radio">
              <input
                type="radio"
                name="conflict-choice"
                checked={choice === 'add_new'}
                onChange={() => setChoice('add_new')}
              />
              {t('workers.confirmAddNew')}
            </label>
            {conflicts.map((c) => (
              <label key={c.workerId} className="confirm-add-cli-radio">
                <input
                  type="radio"
                  name="conflict-choice"
                  checked={choice === c.workerId}
                  onChange={() => setChoice(c.workerId)}
                />
                <span className="confirm-add-cli-conflict">
                  <span className="confirm-add-cli-conflict-name">
                    {t('workers.confirmReuseExisting')}: {c.name}
                    {c.agentVersion && ` v${c.agentVersion}`}
                  </span>
                  <span className="confirm-add-cli-conflict-cmd mono">{c.command}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="confirm-add-cli-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t('workers.confirmCancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={primaryDisabled}
            onClick={handlePrimary}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
