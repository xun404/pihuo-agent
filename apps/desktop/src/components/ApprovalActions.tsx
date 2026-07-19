import type { ApprovalItem } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'

interface ApprovalActionsProps {
  approval: ApprovalItem
  surface: 'chat' | 'panel'
  resolving: Record<string, boolean>
  onResolve: (
    approvalId: string,
    optionId: string | undefined,
    decision: 'allow' | 'deny' | 'cancel',
    surface: 'chat' | 'panel',
  ) => void
  /** wireframe: 线稿 approval-row 内 .btn / .btn.primary / .btn.danger */
  variant?: 'default' | 'wireframe'
}

export function ApprovalActions({
  approval,
  surface,
  resolving,
  onResolve,
  variant = 'default',
}: ApprovalActionsProps) {
  const { t } = useI18n()

  const isResolving = !!resolving[approval.id]

  const allowOptions = approval.options.filter(
    (o) => o.kind === 'allow_once' || o.kind === 'allow_always',
  )
  const rejectOptions = approval.options.filter(
    (o) => o.kind === 'reject_once' || o.kind === 'reject_always',
  )
  const hasNoOptions = allowOptions.length === 0 && rejectOptions.length === 0

  const handleResolve = (optionId: string | undefined, decision: 'allow' | 'deny' | 'cancel') => {
    if (isResolving) return
    onResolve(approval.id, optionId, decision, surface)
  }

  if (variant === 'wireframe') {
    return (
      <>
        {hasNoOptions ? (
          <span className="approval-no-options">{t('approvals.noOptions')}</span>
        ) : (
          <>
            {allowOptions.map((opt) => (
              <button
                key={opt.optionId}
                type="button"
                className={`btn${opt.kind === 'allow_once' ? ' primary' : ''}`}
                disabled={isResolving}
                onClick={() => handleResolve(opt.optionId, 'allow')}
              >
                {opt.name}
              </button>
            ))}
            {rejectOptions.map((opt) => (
              <button
                key={opt.optionId}
                type="button"
                className="btn danger"
                disabled={isResolving}
                onClick={() => handleResolve(opt.optionId, 'deny')}
              >
                {opt.name}
              </button>
            ))}
          </>
        )}
      </>
    )
  }

  return (
    <div className="approval-actions">
      {hasNoOptions ? (
        <div className="approval-no-options">{t('approvals.noOptions')}</div>
      ) : (
        <>
          {allowOptions.length > 0 && (
            <div className="approval-actions-group">
              {allowOptions.map((opt) => (
                <button
                  key={opt.optionId}
                  type="button"
                  className="approval-actions-btn approval-actions-btn-allow"
                  disabled={isResolving}
                  onClick={() => handleResolve(opt.optionId, 'allow')}
                >
                  {opt.name}
                </button>
              ))}
            </div>
          )}
          {rejectOptions.length > 0 && (
            <div className="approval-actions-group">
              {rejectOptions.map((opt) => (
                <button
                  key={opt.optionId}
                  type="button"
                  className="approval-actions-btn approval-actions-btn-deny"
                  disabled={isResolving}
                  onClick={() => handleResolve(opt.optionId, 'deny')}
                >
                  {opt.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
