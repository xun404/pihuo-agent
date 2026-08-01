import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  gitStatusLetter,
  splitDisplayPath,
  summarizeTasks,
  taskDisplayText,
} from './composer-status-helpers.js'
import type { TaskItem } from '../components/chat/TaskListCard.js'

const task = (partial: Partial<TaskItem> & Pick<TaskItem, 'id' | 'content' | 'status'>): TaskItem =>
  partial

describe('summarizeTasks', () => {
  it('counts completed / active / remaining and picks active task', () => {
    const tasks: TaskItem[] = [
      task({ id: '1', content: 'A', status: 'completed' }),
      task({ id: '2', content: 'B', status: 'in_progress', activeForm: 'Doing B' }),
      task({ id: '3', content: 'C', status: 'pending' }),
    ]
    const s = summarizeTasks(tasks)
    assert.equal(s.total, 3)
    assert.equal(s.completed, 1)
    assert.equal(s.active, 1)
    assert.equal(s.remaining, 2)
    assert.equal(s.activeTask?.id, '2')
    assert.equal(s.allDone, false)
  })

  it('falls back to first pending when none in progress', () => {
    const tasks: TaskItem[] = [
      task({ id: '1', content: 'A', status: 'completed' }),
      task({ id: '2', content: 'B', status: 'pending' }),
    ]
    assert.equal(summarizeTasks(tasks).activeTask?.id, '2')
  })

  it('allDone when every task completed', () => {
    const s = summarizeTasks([
      task({ id: '1', content: 'A', status: 'completed' }),
      task({ id: '2', content: 'B', status: 'completed' }),
    ])
    assert.equal(s.allDone, true)
    assert.equal(s.activeTask, null)
    assert.equal(s.remaining, 0)
  })

  it('empty list', () => {
    const s = summarizeTasks([])
    assert.equal(s.total, 0)
    assert.equal(s.activeTask, null)
    assert.equal(s.allDone, false)
  })
})

describe('taskDisplayText', () => {
  it('prefers activeForm for in_progress', () => {
    assert.equal(
      taskDisplayText(
        task({ id: '1', content: 'Full', status: 'in_progress', activeForm: 'Short' }),
      ),
      'Short',
    )
  })

  it('uses content otherwise', () => {
    assert.equal(taskDisplayText(task({ id: '1', content: 'Full', status: 'pending' })), 'Full')
  })
})

describe('splitDisplayPath', () => {
  it('splits dir (no trailing slash) and basename', () => {
    assert.deepEqual(splitDisplayPath('apps/desktop/src/ChatPanel.tsx'), {
      dirPart: 'apps/desktop/src',
      fileName: 'ChatPanel.tsx',
    })
  })

  it('handles bare filename', () => {
    assert.deepEqual(splitDisplayPath('README.md'), { dirPart: '', fileName: 'README.md' })
  })
})

describe('gitStatusLetter', () => {
  it('takes first letter uppercased', () => {
    assert.equal(gitStatusLetter('modified'), 'M')
    assert.equal(gitStatusLetter('A'), 'A')
    assert.equal(gitStatusLetter(''), '?')
  })
})
