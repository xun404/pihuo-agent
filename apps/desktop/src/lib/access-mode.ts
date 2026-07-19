/**
 * Access mode: unifies Leader mode + approval policy into one Composer control.
 * @see docs/superpowers/specs/2026-07-16-desktop-ui-redesign-design.md §5.3 / §9.2
 */
import type { LeaderMode, SessionApprovalPolicy } from '@router-agents/shared'

export type AccessModeId = 'confirm' | 'auto_edit' | 'plan' | 'full_access'

export type AccessModeDef = {
  id: AccessModeId
  /** i18n key for title */
  titleKey: 'access.confirm' | 'access.autoEdit' | 'access.plan' | 'access.full'
  /** i18n key for description */
  descKey: 'access.confirmDesc' | 'access.autoEditDesc' | 'access.planDesc' | 'access.fullDesc'
  mode: LeaderMode
  policy: SessionApprovalPolicy
  /** Orange chip styling for full access */
  accent?: boolean
}

export const ACCESS_MODES: AccessModeDef[] = [
  {
    id: 'confirm',
    titleKey: 'access.confirm',
    descKey: 'access.confirmDesc',
    mode: 'build',
    policy: 'manual',
  },
  {
    id: 'auto_edit',
    titleKey: 'access.autoEdit',
    descKey: 'access.autoEditDesc',
    mode: 'build',
    policy: 'allow_always',
  },
  {
    id: 'plan',
    titleKey: 'access.plan',
    descKey: 'access.planDesc',
    mode: 'plan',
    policy: 'manual',
  },
  {
    id: 'full_access',
    titleKey: 'access.full',
    descKey: 'access.fullDesc',
    mode: 'build',
    policy: 'allow_always',
    accent: true,
  },
]

/** Best-effort reverse map from current session state → access mode chip. */
export function resolveAccessMode(mode: LeaderMode, policy: SessionApprovalPolicy): AccessModeId {
  if (mode === 'plan') return 'plan'
  if (mode === 'ask') return 'confirm'
  if (mode === 'review') return 'confirm'
  // build
  if (policy === 'manual' || policy === 'reject_once' || policy === 'reject_always') {
    return 'confirm'
  }
  if (policy === 'allow_always') return 'full_access'
  if (policy === 'allow_once') return 'auto_edit'
  return 'confirm'
}

export function accessModeById(id: AccessModeId): AccessModeDef {
  return ACCESS_MODES.find((m) => m.id === id) ?? ACCESS_MODES[0]!
}
