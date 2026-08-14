import type { ApprovalItem, ApprovalOptionKind } from '@pihuo-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/locales.js'

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

const OPTION_LABEL_KEYS: Record<ApprovalOptionKind, MessageKey> = {
  allow_once: 'approvals.allowOnce',
  allow_always: 'approvals.allowAlways',
  reject_once: 'approvals.rejectOnce',
  reject_always: 'approvals.rejectAlways',
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
  const hasUnknownScope = !approval.locations || approval.locations.length === 0
  const hasAgentAlways = allowOptions.some((option) => option.kind === 'allow_always')

  const optionLabel = (kind: ApprovalOptionKind, fallbackName: string) => {
    const key = OPTION_LABEL_KEYS[kind]
    const label = key ? t(key) : fallbackName
    return `[${label}]`
  }

  const cancelLabel = () => `[${t('approvals.cancel')}]`

  const handleResolve = (optionId: string | undefined, decision: 'allow' | 'deny' | 'cancel') => {
    if (isResolving) return
    onResolve(approval.id, optionId, decision, surface)
  }

  if (variant === 'wireframe') {
    return (
      <>
        {hasUnknownScope && (
          <div className="approval-scope-hint">{t('approvals.unknownScope')}</div>
        )}
        {hasAgentAlways && (
          <div className="approval-agent-hint">{t('approvals.agentAlwaysHint')}</div>
        )}
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
                {optionLabel(opt.kind, opt.name)}
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
                {optionLabel(opt.kind, opt.name)}
              </button>
            ))}
          </>
        )}
        <button
          type="button"
          className="btn btn-cancel"
          disabled={isResolving}
          onClick={() => handleResolve(undefined, 'cancel')}
        >
          {cancelLabel()}
        </button>
      </>
    )
  }

  return (
    <div className="approval-actions">
      {hasUnknownScope && <div className="approval-scope-hint">{t('approvals.unknownScope')}</div>}
      {hasAgentAlways && (
        <div className="approval-agent-hint">{t('approvals.agentAlwaysHint')}</div>
      )}
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
                  {optionLabel(opt.kind, opt.name)}
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
                  {optionLabel(opt.kind, opt.name)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="approval-actions-group">
        <button
          type="button"
          className="approval-actions-btn approval-actions-btn-cancel"
          disabled={isResolving}
          onClick={() => handleResolve(undefined, 'cancel')}
        >
          {cancelLabel()}
        </button>
      </div>
    </div>
  )
}
