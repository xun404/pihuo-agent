import type { WorkerReadinessStatus } from '@swarmdesk-agent/shared'
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
            prepared: 'Pending',
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
            prepared: '待激活',
            auth_required: '需认证',
            ready: '就绪',
            failed: '失败',
            incompatible: '不兼容',
            update_available: '有更新',
          } as const
        )[ui]
  // Human-readable hover explanation per status (replaces raw backend code/message).
  const description =
    locale === 'en'
      ? (
          {
            cataloged: 'Listed in the registry; not yet installed.',
            preparing: 'Downloading and verifying the agent package.',
            prepared: 'Installed; ACP probe and authentication not yet completed.',
            auth_required: 'Installed; authentication required before use.',
            ready: 'Installed and reachable.',
            failed: 'ACP setup failed. Retry the probe.',
            incompatible: 'Agent is not compatible with this host.',
            update_available: 'A newer version is available.',
          } as const
        )[ui]
      : (
          {
            cataloged: '已在 Registry 收录，尚未安装。',
            preparing: '正在下载并校验 Agent 安装包。',
            prepared: '已安装，尚未完成 ACP 探测与认证。',
            auth_required: '已安装，使用前需要完成认证。',
            ready: '已安装且可正常连接。',
            failed: 'ACP 初始化失败，请重新探测。',
            incompatible: '该 Agent 与当前主机不兼容。',
            update_available: '有新版本可用。',
          } as const
        )[ui]

  return (
    <span
      className={`worker-readiness-badge worker-readiness-badge--${ui}`}
      title={description}
      data-status={ui}
      data-code={props.code}
      data-next-action={props.nextAction}
    >
      {label}
    </span>
  )
}
