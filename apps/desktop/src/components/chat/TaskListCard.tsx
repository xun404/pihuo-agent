/**
 * TaskListCard —— 渲染 Leader 的任务列表（来自 data-signal / task-list-update）。
 *
 * 数据源：Mastra TaskSignalProvider 下发的 `data-signal` part，
 *   part.data.metadata.value.tasks = TaskItem[]（全量快照，每次更新都是当前完整列表）。
 *
 * 视觉（线稿 icon-spec-v3 / floating-process）：
 *   - 标题行：任务进度 + N/M 计数 + 进度条 + live 标签
 *   - 每行任务：状态图标（Circle/Clock/CircleCheck）+ role 标签（从 content 前缀 [role] 解析）+ 文本
 *   - role 配色复用现有 worker-card-head .node-cap 规则：plan紫/coder蓝/review橙/research绿
 *
 * 全用 CSS 变量，三套主题（warm/classic/dark）自动适配。
 */
import { memo } from 'react'
import { IconClock } from '../Icons'

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

/** role → node-cap 语义类名（复用 worker role 配色） */
function roleClass(role: string | null): string {
  if (!role) return ''
  if (role.includes('plan') || role.includes('arch')) return 'role-plan'
  if (role.includes('cod') || role.includes('dev')) return 'role-coder'
  if (role.includes('rev')) return 'role-review'
  if (role.includes('test') || role.includes('res') || role.includes('search')) return 'role-research'
  return ''
}

function TaskListCardImpl({ tasks }: { tasks: TaskItem[] }) {
  const inProgress = tasks.filter((t) => t.status === 'in_progress')
  if (inProgress.length === 0) return null

  return (
    <div className="task-card" role="group" aria-label="任务进度">
      <div className="task-card-body">
        {inProgress.map((task) => {
          const { role, text } = parseRole(task.content)
          const rc = roleClass(role)
          return (
            <div
              key={task.id}
              className={`task-row task-in_progress${rc ? ` ${rc}` : ''}`}
              data-status="in_progress"
            >
              <span className="task-row-icon" aria-hidden>
                <IconClock size={14} />
              </span>
              {role && <span className="task-row-role">[{role}]</span>}
              <span className="task-row-text">{text}</span>
              {task.activeForm && (
                <span className="task-row-active">{task.activeForm}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const TaskListCard = memo(TaskListCardImpl)
