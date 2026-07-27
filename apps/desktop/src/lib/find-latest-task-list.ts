/**
 * 从 messages（扁平 UIMessage[]）里提取最新的 task 列表快照。
 *
 * data-signal 的 task 快照以两种 tagName 下发：
 *   - 'task-list-update'（增量模式，但 metadata.value.tasks 仍是全量当前列表）
 *   - 'current-task-list'（快照模式）
 * 全量 tasks 在 part.data.metadata.value.tasks（fallback part.data.value.tasks）。
 *
 * 倒序遍历，取最后一条带 task 快照的 part（= 最新状态）。
 * 遇到 user 消息即止（task 跨不过 user turn；旧 turn 的 task 不污染当前视图）。
 *
 * 模式参考：lib/leader-step-budget.ts 的 findLatestActionableBudget。
 */
import type { UIMessage } from '@ai-sdk/react'
import type { TaskItem } from '../components/chat/TaskListCard'

type AnyMessage = UIMessage<any>

type DataSignalPart = {
  type: 'data-signal'
  data?: {
    tagName?: string
    metadata?: { value?: { tasks?: unknown } }
    value?: { tasks?: unknown }
  }
}

/** 从单个 data-signal part 解析 tasks，非 task 快照或无内容返回 null */
function tasksOf(part: unknown): TaskItem[] | null {
  const p = part as DataSignalPart
  if (!p || p.type !== 'data-signal') return null
  const tagName = p.data?.tagName
  if (tagName !== 'task-list-update' && tagName !== 'current-task-list') return null
  const raw = p.data?.metadata?.value?.tasks ?? p.data?.value?.tasks
  if (!Array.isArray(raw) || raw.length === 0) return null
  return raw as TaskItem[]
}

/**
 * 返回最新的 task 列表快照；没有任何 task 时返回 null。
 * 浮窗据此决定显示/隐藏（无 task → 不渲染浮窗）。
 *
 * 注意：task 列表是会话级工作流进度（Leader 的 TaskSignalProvider 维护的全量快照），
 * 不局限于单个 user turn。即使最新的 turn 是纯文本问答，之前轮次设定的 task 仍应
 * 在浮窗里持续可见（直到被新 task 覆盖或会话结束）。因此全程倒序查找，
 * 不在 user 消息处中断。
 */
export function findLatestTaskList(messages: AnyMessage[]): TaskItem[] | null {
  for (let k = messages.length - 1; k >= 0; k--) {
    const msg = messages[k]!
    const parts = (msg as { parts?: unknown[] }).parts
    if (!Array.isArray(parts)) continue
    for (let j = parts.length - 1; j >= 0; j--) {
      const tasks = tasksOf(parts[j])
      if (tasks) return tasks
    }
  }
  return null
}
