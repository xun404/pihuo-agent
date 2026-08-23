/**
 * TaskListCard —— 渲染 Leader 的任务列表（来自 data-signal / task-list-update）。
 *
 * 数据源：Leader task tools 下发的 `data-signal` part，
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
import { CheckCircle2, ChevronRight, Circle, Clock3, ListTodo } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { useCollapsible } from './useCollapsible'

/** Leader task item rendered from the session task-list snapshot. */
export type TaskItem = {
  id: string
  content: string
  status: 'pending' | 'completed' | 'in_progress'
  activeForm?: string
}

/** 从 content 前缀解析角色标签，如 "[architect] 设计分层" → { role:'architect', text:'设计分层' } */
export function parseRole(content: string): { role: string | null; text: string } {
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

function DiscussionTaskList({ tasks }: { tasks: TaskItem[] }) {
  const { t } = useI18n()
  if (tasks.length === 0) return null
  const completed = tasks.filter((task) => task.status === 'completed').length
  const statusLabel = (status: TaskItem['status']) => {
    if (status === 'completed') return t('chat.discussionTaskCompleted')
    if (status === 'in_progress') return t('chat.discussionTaskInProgress')
    return t('chat.discussionTaskPending')
  }

  return (
    <section
      className="discussion-task-card"
      data-discussion-task-card
      role="group"
      aria-label={t('chat.discussionTodo')}
    >
      <header className="discussion-task-card-head">
        <span className="discussion-task-card-title">
          <ListTodo size={16} aria-hidden />
          {t('chat.discussionTodo')}
        </span>
        <span className="discussion-task-card-count">
          {completed} / {tasks.length} {t('chat.discussionTaskCompleted')}
        </span>
      </header>
      <div className="discussion-task-list">
        {tasks.map((task) => {
          const { role, text } = parseRole(task.content)
          const Icon =
            task.status === 'completed'
              ? CheckCircle2
              : task.status === 'in_progress'
                ? Circle
                : Clock3
          return (
            <div
              className={`discussion-task-row is-${task.status}`}
              key={task.id}
              data-status={task.status}
            >
              <Icon className="discussion-task-status-icon" size={20} aria-hidden />
              <span className="discussion-task-content">
                <span>{text}</span>
                {role && <span className="discussion-task-role">{role}</span>}
              </span>
              <span className="discussion-task-state">{statusLabel(task.status)}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TaskListCardImpl({
  tasks,
  discussionMode = false,
}: {
  tasks: TaskItem[]
  discussionMode?: boolean
}) {
  const { t } = useI18n()
  if (discussionMode) return <DiscussionTaskList tasks={tasks} />
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
