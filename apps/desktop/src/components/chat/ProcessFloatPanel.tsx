/**
 * ProcessFloatPanel —— 右上角浮窗进程气泡（task 可视化载体）。
 *
 * 设计线稿（floating-process.html / icon-spec-v3.html）：
 *   - 挂在 ChatPanel <main> 容器右上角，absolute top:14 right:14，浮在消息流之上
 *   - 双模式：panel（默认，完整列表）/ mini（窄窗/手动折叠，一行 pill）
 *   - panel header：进程 + N/M 计数 + 折叠/关闭按钮
 *   - 任务行：状态图标（Circle/Clock/CircleCheck）+ role + 文本
 *   - >6 项时折叠为「已完成 N 项」/「待处理 N 项」分组（参考 zcode summary-panel）
 *
 * 全用 CSS 变量，三套主题（warm/classic/dark）自动适配。
 * 持久化：mode 用 useState（in-session），不跨 session（项目无 UI-pref 持久化机制）。
 */
import { memo, useState } from 'react'
import { Minimize2, Maximize2 } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { Circle, CircleCheck, IconClock } from '../Icons'
import type { TaskItem } from './TaskListCard'

type Mode = 'panel' | 'mini'

/** 从 content 前缀 [role] 解析角色 */
function parseRole(content: string): { role: string | null; text: string } {
  const m = content.match(/^\s*\[([a-zA-Z_-]+)\]\s*(.*)$/)
  if (!m) return { role: null, text: content }
  return { role: m[1].toLowerCase(), text: m[2] || content }
}

function roleClass(role: string | null): string {
  if (!role) return ''
  if (role.includes('plan') || role.includes('arch')) return 'role-plan'
  if (role.includes('cod') || role.includes('dev')) return 'role-coder'
  if (role.includes('rev')) return 'role-review'
  if (role.includes('test') || role.includes('res') || role.includes('search'))
    return 'role-research'
  return ''
}

interface Props {
  tasks: TaskItem[]
  /** 强制模式（外部控制）；不传则内部 useState */
  mode?: Mode
  defaultMode?: Mode
}

function ProcessFloatPanelImpl({ tasks, mode: modeProp, defaultMode = 'mini' }: Props) {
  const [modeState, setModeState] = useState<Mode>(defaultMode)
  const mode = modeProp ?? modeState
  const { t } = useI18n()

  if (tasks.length === 0) return null

  const total = tasks.length
  const completed = tasks.filter((t) => t.status === 'completed').length
  const hasInProgress = tasks.some((t) => t.status === 'in_progress')
  const activeTask = tasks.find((t) => t.status === 'in_progress')
  const allDone = completed === total
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  // ============ mini 模式：一行 pill，默认折叠，显示当前执行任务 ============
  if (mode === 'mini') {
    const activeText = activeTask
      ? activeTask.activeForm || parseRole(activeTask.content).text
      : allDone
        ? t('chat.process.allDone')
        : ''
    return (
      <div
        key="proc-mini"
        className="proc-float proc-mini"
        role="button"
        tabIndex={0}
        aria-label={t('chat.process.miniAria')}
        onClick={() => setModeState('panel')}
      >
        <CircleCheck size={13} />
        <span className="proc-mini-label">{t('chat.process.label')}</span>
        <span className="proc-mini-count">
          {completed}/{total}
        </span>
        {activeText && <span className="proc-mini-task">{activeText}</span>}
        {hasInProgress && <span className="proc-mini-pip" aria-hidden />}
        <button
          type="button"
          className="proc-mini-expand"
          aria-label="展开"
          onClick={(e) => {
            e.stopPropagation()
            setModeState('panel')
          }}
        >
          <Maximize2 size={12} />
        </button>
      </div>
    )
  }

  // ============ panel 模式：完整列表 ============
  // >6 项 → 折叠 focus window（参考 zcode Dst 分组逻辑）
  const compact = total > 6
  const doneTasks = tasks.filter((t) => t.status === 'completed')
  const pendingTasks = tasks.filter((t) => t.status !== 'completed')
  const focusTasks = compact ? pendingTasks : tasks

  return (
    <div key="proc-panel" className="proc-float proc-panel" role="complementary" aria-label={t('chat.process.panelAria')}>
      {/* header */}
      <div className="proc-head">
        <span className="proc-head-title">
          <CircleCheck size={14} />
          <span>{t('chat.process.label')}</span>
        </span>
        <span className={`proc-head-count${allDone ? ' all-done' : ''}`}>
          {completed} / {total}
        </span>
        <span className="proc-head-bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </span>
        {hasInProgress && (
          <span className="proc-head-live">
            <span className="proc-head-live-dot" aria-hidden />
            {t('chat.process.live')}
          </span>
        )}
        <span className="proc-head-acts">
          <button
            type="button"
            className="proc-head-btn"
            aria-label={t('chat.process.minimizeAria')}
            title={t('chat.process.minimize')}
            onClick={() => setModeState('mini')}
          >
            <Minimize2 size={12} />
          </button>
        </span>
      </div>
      {/* body */}
      <div className="proc-body">
        {/* 折叠：已完成分组 */}
        {compact && doneTasks.length > 0 && <DoneFold count={doneTasks.length} />}
        {/* focus 任务行 */}
        {focusTasks.map((task) => {
          const { role, text } = parseRole(task.content)
          const rc = roleClass(role)
          return (
            <div
              key={task.id}
              className={`proc-task proc-${task.status}${rc ? ` ${rc}` : ''}`}
              data-status={task.status}
            >
              <span className="proc-task-icon" aria-hidden>
                {task.status === 'completed' ? (
                  <CircleCheck size={14} />
                ) : task.status === 'in_progress' ? (
                  <IconClock size={14} />
                ) : (
                  <Circle size={14} />
                )}
              </span>
              {role && <span className="proc-task-role">[{role}]</span>}
              <span className="proc-task-text">{text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 折叠的「已完成 N 项」分组行 */
function DoneFold({ count }: { count: number }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      className="proc-fold"
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
    >
      <span className={`proc-fold-chev${open ? ' open' : ''}`} aria-hidden>
        <ChevronRight />
      </span>
      <span className="proc-fold-label">
        {open ? t('chat.process.doneFoldCollapse', { count }) : t('chat.process.doneFold', { count })}
      </span>
    </button>
  )
}

// —— 内联小图标（DoneFold 的 chevron；其余用 lucide-react）——
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export const ProcessFloatPanel = memo(ProcessFloatPanelImpl)
