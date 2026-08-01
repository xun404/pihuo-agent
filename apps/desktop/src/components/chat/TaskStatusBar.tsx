/**
 * Composer-adjacent task progress.
 * Expandable popover with completed/total list — replaces ProcessFloatPanel.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { Circle, CircleCheck, IconClock } from '../Icons'
import { useI18n } from '../../i18n/I18nProvider'
import { summarizeTasks, taskDisplayText } from '../../lib/composer-status-helpers'
import type { TaskItem } from './TaskListCard'

const popoverMotion = {
  initial: { opacity: 0, y: 8, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.98 },
  transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] as const },
}

type Props = {
  tasks: TaskItem[]
}

function statusIcon(status: TaskItem['status']) {
  if (status === 'completed') return <CircleCheck size={14} />
  if (status === 'in_progress') return <Circle size={14} className="task-status-icon-live" />
  return <IconClock size={14} />
}

function TaskStatusBarImpl({ tasks }: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const summary = summarizeTasks(tasks)

  useEffect(() => {
    if (!expanded) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [expanded])

  if (tasks.length === 0) return null

  const triggerLabel = summary.allDone
    ? t('chat.process.allDone')
    : summary.activeTask
      ? taskDisplayText(summary.activeTask)
      : t('chat.statusRow.tasksTitle')

  return (
    <div className="task-status-bar" ref={rootRef}>
      <button
        type="button"
        className="task-status-trigger"
        aria-expanded={expanded}
        aria-label={t('chat.statusRow.tasksAria', {
          completed: String(summary.completed),
          total: String(summary.total),
        })}
        title={triggerLabel}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="task-status-active">{triggerLabel}</span>
        {summary.allDone ? (
          <span className="task-status-meta tabular" aria-hidden>
            {summary.completed}/{summary.total}
          </span>
        ) : (
          <span className="task-status-meta" aria-hidden>
            <span className="task-status-meta-item">
              <Circle size={12} className="task-status-icon-live" />
              {summary.active}
            </span>
            <span className="task-status-meta-sep">·</span>
            <span className="task-status-meta-item">
              <IconClock size={12} />
              {summary.remaining}
            </span>
          </span>
        )}
        <ChevronDown size={14} className="composer-status-chevron" aria-hidden />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            key="task-popover"
            className="composer-status-popover task-status-popover"
            role="dialog"
            {...popoverMotion}
          >
            <div className="composer-status-popover-head">
              <span>{t('chat.statusRow.tasksTitle')}</span>
              <span className="composer-status-popover-count tabular">
                {summary.completed}/{summary.total}
              </span>
            </div>
            <div className="composer-status-popover-list">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={`task-status-row is-${task.status}`}
                  title={task.content}
                >
                  <span className="task-status-row-icon" aria-hidden>
                    {statusIcon(task.status)}
                  </span>
                  <span className="task-status-row-text">{task.content}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export const TaskStatusBar = memo(TaskStatusBarImpl)
