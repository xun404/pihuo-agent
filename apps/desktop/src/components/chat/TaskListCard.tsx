/**
 * TaskListCard —— 渲染 Leader 的任务列表（来自 data-signal / task-list-update）。
 *
 * 数据源：Mastra TaskSignalProvider 下发的 `data-signal` part，
 *   part.data.metadata.value.tasks = TaskItem[]（全量快照，每次更新都是当前完整列表）。
 *
 * 视觉（线稿 icon-spec-v3 / floating-process）：
 *   - 标题行：任务进度 + N/M 计数 + 进度条 + live 标签
 *   - 折叠：中性 ListTodo 图标 + “任务 role”纯文本标题 + activeForm 预览
 *   - 展开：箭头 + “任务 role”标题；完整 content 放在下方导轨内
 *
 * 全用 CSS 变量，内置及用户主题自动适配。
 */
import { memo, useCallback, useState } from 'react'
import { ChevronRight, ListTodo } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { useCollapsible } from './useCollapsible'

/** Mastra TaskItem（本地结构类型，避免依赖 @mastra/core 内部 d.ts） */
export type TaskItem = {
  id: string
  content: string
  status: 'pending' | 'completed' | 'in_progress'
  activeForm?: string
}

/** 从 content 前缀解析角色标签，如 "[architect] 设计分层" → { role:'architect', text:'设计分层' } */
function parseRole(content: string): { role: string | null; text: string } {
  const m = content.match(/^\s*\[([a-zA-Z_-]+)\]\s*(.*)$/)
  if (!m) return { role: null, text: content }
  return { role: m[1].toLowerCase(), text: m[2] || content }
}

type TaskProcessRowProps = {
  task: TaskItem
  /** Controlled open state. Omit to let the row manage its own state. */
  open?: boolean
  onToggle?: (open: boolean) => void
}

/** A single active task rendered with the shared thinking/tool process-row contract. */
export function TaskProcessRow({ task, open, onToggle }: TaskProcessRowProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen
  const { t } = useI18n()
  const { role, text } = parseRole(task.content)
  const detail = text.trim()
  const summary = task.activeForm?.trim() || detail
  const hasDetail = Boolean(detail)
  const { shouldRender, contentRef } = useCollapsible({ open: isOpen })

  const toggle = useCallback(() => {
    if (!hasDetail) return
    const next = !isOpen
    if (open === undefined) setInternalOpen(next)
    onToggle?.(next)
  }, [hasDetail, isOpen, onToggle, open])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      toggle()
    },
    [toggle],
  )

  return (
    <div className={`task-process-row${isOpen ? ' is-open' : ''}`} data-status="in_progress">
      <div
        className="task-row task-in_progress process-row-summary"
        role={hasDetail ? 'button' : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        aria-expanded={hasDetail ? isOpen : undefined}
        onClick={hasDetail ? toggle : undefined}
        onKeyDown={hasDetail ? onKeyDown : undefined}
      >
        <span className="task-row-icon process-icon-slot" aria-hidden>
          <span className="task-row-icon-type process-icon-type">
            <ListTodo size={14} />
          </span>
          <span className="task-row-icon-chevron process-icon-chevron">
            <ChevronRight size={10} />
          </span>
        </span>
        <span className="task-row-heading">
          <span className="task-row-label">{t('chat.taskLabel')}</span>
          {role && <span className="task-row-role-text">{role}</span>}
        </span>
        {!isOpen && summary ? (
          <span className="task-row-preview" title={summary}>
            {summary}
          </span>
        ) : null}
      </div>

      {shouldRender && hasDetail && (
        <div ref={contentRef} aria-hidden={!isOpen} className="task-row-collapse">
          <div
            className="task-row-detail process-collapse-body"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            }}
          >
            {detail}
          </div>
        </div>
      )}
    </div>
  )
}

function TaskListCardImpl({ tasks }: { tasks: TaskItem[] }) {
  const { t } = useI18n()
  const inProgress = tasks.filter((t) => t.status === 'in_progress')
  if (inProgress.length === 0) return null

  return (
    <div className="task-list" role="group" aria-label={t('chat.taskProgress')}>
      {inProgress.map((task) => (
        <TaskProcessRow key={task.id} task={task} />
      ))}
    </div>
  )
}

export const TaskListCard = memo(TaskListCardImpl)
