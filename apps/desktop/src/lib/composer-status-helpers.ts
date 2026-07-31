/**
 * Pure helpers for the composer status row (tasks + pending git changes).
 */
import type { TaskItem } from '../components/chat/TaskListCard'

export type TaskSummary = {
  total: number
  completed: number
  active: number
  remaining: number
  /** First in_progress, else first pending, else null (all done / empty). */
  activeTask: TaskItem | null
  allDone: boolean
}

export function summarizeTasks(tasks: TaskItem[]): TaskSummary {
  const total = tasks.length
  const completed = tasks.filter((t) => t.status === 'completed').length
  const active = tasks.filter((t) => t.status === 'in_progress').length
  const remaining = tasks.filter((t) => t.status !== 'completed').length
  const activeTask =
    tasks.find((t) => t.status === 'in_progress') ??
    tasks.find((t) => t.status === 'pending') ??
    null
  return {
    total,
    completed,
    active,
    remaining,
    activeTask,
    allDone: total > 0 && completed === total,
  }
}

/** Display label for a task row / trigger (prefer activeForm when in progress). */
export function taskDisplayText(task: TaskItem): string {
  if (task.status === 'in_progress' && task.activeForm?.trim()) {
    return task.activeForm.trim()
  }
  return task.content.trim()
}

/**
 * Split a path for list display.
 * - `dirPart`: muted prefix (no trailing slash — render `/` outside the RTL ellipsis box)
 * - `fileName`: basename only (emphasized, never truncated)
 */
export function splitDisplayPath(path: string): { dirPart: string; fileName: string } {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/')
  const i = normalized.lastIndexOf('/')
  if (i < 0) return { dirPart: '', fileName: normalized }
  // No trailing slash on dirPart: with direction:rtl the trailing `/` was visually
  // separated from the filename and looked like "constantsCommonConstant.java".
  return {
    dirPart: normalized.slice(0, i),
    fileName: normalized.slice(i + 1),
  }
}

export function gitStatusLetter(status: string): string {
  const s = (status || '').trim()
  if (!s) return '?'
  return s[0]!.toUpperCase()
}
