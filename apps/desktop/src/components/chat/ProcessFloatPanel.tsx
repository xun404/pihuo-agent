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
import { CircleCheck } from '../Icons'
import type { TaskItem } from './TaskListCard'

type Mode = 'panel' | 'mini'

/** 从 content 前缀 [role] 解析角色 */
function parseRole(content: string): { role: string | null; text: string } {
  const m = content.match(/^\s*\[([a-zA-Z_-]+)\]\s*(.*)$/)
  if (!m) return { role: null, text: content }
  return { role: m[1].toLowerCase(), text: m[2] || content }
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
        ? '全部完成'
        : ''
    return (
      <div
        key="proc-mini"
        className="proc-float proc-mini"
        role="button"
        tabIndex={0}
        aria-label="进程（点击展开）"
        onClick={() => setModeState('panel')}
      >
        <CircleCheck size={13} />
        <span className="proc-mini-label">进程</span>
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

  // ============ panel 模式：只展示 header，任务列表折叠时不展示 ============
  return (
    <div key="proc-panel" className="proc-float proc-panel" role="complementary" aria-label="任务进程">
      <div className="proc-head">
        <span className="proc-head-title">
          <CircleCheck size={14} />
          <span>进程</span>
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
            执行中
          </span>
        )}
        <span className="proc-head-acts">
          <button
            type="button"
            className="proc-head-btn"
            aria-label="折叠为迷你"
            title="折叠"
            onClick={() => setModeState('mini')}
          >
            <Minimize2 size={12} />
          </button>
        </span>
      </div>
    </div>
  )
}

export const ProcessFloatPanel = memo(ProcessFloatPanelImpl)
