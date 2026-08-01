export type TaskStatus = 'todo' | 'doing' | 'done'

export type Task = {
  id: string
  title: string
  status: TaskStatus
  owner?: string
}

const BOARD: Task[] = [
  { id: 't1', title: 'Wire session sidebar rename', status: 'done', owner: 'coder' },
  { id: 't2', title: 'Surface ACP approvals in chat', status: 'doing', owner: 'review' },
  { id: 't3', title: 'Document showcase seed flow', status: 'todo', owner: 'plan' },
]

export function listOpenTasks(): Task[] {
  return BOARD.filter((t) => t.status !== 'done')
}

export function listAllTasks(): Task[] {
  return [...BOARD]
}
