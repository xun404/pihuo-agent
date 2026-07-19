import type { WorkerReadinessStatus } from '@router-agents/shared'
import { readinessToUiStatus } from '../lib/worker-registry'

export function WorkerReadinessBadge(props: {
  status?: WorkerReadinessStatus | string | null
  code?: string
  nextAction?: string
  locale?: 'zh' | 'en'
}) {
  const ui = readinessToUiStatus(props.status)
  const locale = props.locale ?? 'zh'
  const label =
    locale === 'en'
      ? (
          {
            cataloged: 'Cataloged',
            preparing: 'Preparing',
            prepared: 'Prepared',
            auth_required: 'Auth required',
            ready: 'Ready',
            failed: 'Failed',
            incompatible: 'Incompatible',
            update_available: 'Update available',
          } as const
        )[ui]
      : (
          {
            cataloged: '已收录',
            preparing: '准备中',
            prepared: '已准备',
            auth_required: '需认证',
            ready: '就绪',
            failed: '失败',
            incompatible: '不兼容',
            update_available: '有更新',
          } as const
        )[ui]

  return (
    <span
      className={`worker-readiness-badge worker-readiness-badge--${ui}`}
      title={props.code ?? props.nextAction ?? label}
      data-status={ui}
      data-code={props.code}
      data-next-action={props.nextAction}
    >
      {label}
    </span>
  )
}
