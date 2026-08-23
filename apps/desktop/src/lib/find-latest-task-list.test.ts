import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findLatestTaskList } from './find-latest-task-list.js'

describe('findLatestTaskList', () => {
  it('lets a later empty snapshot clear an earlier in-progress task', () => {
    const tasks = findLatestTaskList([
      {
        role: 'assistant',
        parts: [
          {
            type: 'data-signal',
            data: {
              tagName: 'current-task-list',
              metadata: {
                value: {
                  tasks: [{ id: 'task-1', content: '旧任务', status: 'in_progress' }],
                },
              },
            },
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'data-signal',
            data: { tagName: 'current-task-list', metadata: { value: { tasks: [] } } },
          },
        ],
      },
    ])

    assert.deepEqual(tasks, [])
  })
})
