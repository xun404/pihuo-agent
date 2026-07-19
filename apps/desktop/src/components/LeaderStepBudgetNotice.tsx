import { memo } from 'react'
import type { LeaderStepBudgetEvent } from '@swarmdesk-agent/shared'

interface LeaderStepBudgetNoticeProps {
  event: LeaderStepBudgetEvent
  canContinue: boolean
  busy: boolean
  onContinue: () => void
  continueLabel: string
  description: string
}

export const LeaderStepBudgetNotice = memo(function LeaderStepBudgetNotice({
  event,
  canContinue,
  busy,
  onContinue,
  continueLabel,
  description,
}: LeaderStepBudgetNoticeProps) {
  const disabled = !canContinue || busy

  return (
    <div className="leader-budget-notice">
      <div className="leader-budget-notice-header">
        <span className="badge badge-blue">Leader</span>
        <span className="leader-budget-notice-title">Step Budget</span>
        <span className="leader-budget-notice-steps">
          {event.data.usedSteps}/{event.data.maxSteps}
        </span>
      </div>
      <div className="leader-budget-notice-text">{description}</div>
      {canContinue && (
        <button
          className="leader-budget-notice-btn"
          type="button"
          disabled={disabled}
          onClick={onContinue}
        >
          {busy ? '...' : continueLabel}
        </button>
      )}
    </div>
  )
})
