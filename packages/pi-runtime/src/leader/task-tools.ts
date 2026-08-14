import { Type } from 'typebox'
import { defineTool } from '@earendil-works/pi-coding-agent'
import type { LeaderTaskItem } from '@pihuo-agent/shared'

const tasksByThread = new Map<string, LeaderTaskItem[]>()

export function getLeaderTasks(threadId: string): LeaderTaskItem[] {
  return tasksByThread.get(threadId) ?? []
}

export function setLeaderTasks(threadId: string, tasks: LeaderTaskItem[]): LeaderTaskItem[] {
  const next = tasks.map((task) => ({ ...task }))
  tasksByThread.set(threadId, next)
  return next
}

export function clearLeaderTasks(threadId: string): void {
  tasksByThread.delete(threadId)
}

function upsertTask(threadId: string, task: LeaderTaskItem): LeaderTaskItem[] {
  const current = getLeaderTasks(threadId)
  const index = current.findIndex((item) => item.id === task.id)
  if (index === -1) return setLeaderTasks(threadId, [...current, task])
  const next = current.slice()
  next[index] = { ...current[index], ...task }
  return setLeaderTasks(threadId, next)
}

export function createTaskTools(threadId: string) {
  const taskWriteTool = defineTool({
    name: 'task-write',
    label: 'Task write',
    description: 'Create or replace a coordination task in the current session list.',
    parameters: Type.Object({
      id: Type.String(),
      content: Type.String(),
      status: Type.Optional(
        Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')]),
      ),
      activeForm: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const tasks = upsertTask(threadId, {
        id: params.id,
        content: params.content,
        status: params.status ?? 'pending',
        ...(params.activeForm ? { activeForm: params.activeForm } : {}),
      })
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, tasks }) }], details: { tasks } }
    },
  })

  const taskUpdateTool = defineTool({
    name: 'task-update',
    label: 'Task update',
    description: 'Update a coordination task status or content.',
    parameters: Type.Object({
      id: Type.String(),
      content: Type.Optional(Type.String()),
      status: Type.Optional(
        Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')]),
      ),
      activeForm: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const current = getLeaderTasks(threadId).find((task) => task.id === params.id)
      if (!current) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task not found' }) }],
          details: { ok: false, tasks: getLeaderTasks(threadId) },
        }
      }
      const tasks = upsertTask(threadId, {
        ...current,
        ...params,
      })
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, tasks }) }], details: { ok: true, tasks } }
    },
  })

  const taskListTool = defineTool({
    name: 'task-list',
    label: 'Task list',
    description: 'Read the current coordination task list.',
    parameters: Type.Object({}),
    execute: async () => {
      const tasks = getLeaderTasks(threadId)
      return { content: [{ type: 'text', text: JSON.stringify({ tasks }) }], details: { tasks } }
    },
  })

  return [taskWriteTool, taskUpdateTool, taskListTool]
}

export const TASK_TOOL_NAMES = ['task-write', 'task-update', 'task-list'] as const
