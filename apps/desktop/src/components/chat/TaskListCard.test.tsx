import React from 'react'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../../i18n/I18nProvider.js'
import * as TaskListModule from './TaskListCard.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

describe('TaskListCard', () => {
  it('renders Task and role as a plain heading before the collapsed action preview', () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { serverLocale: 'en' },
        createElement(TaskListModule.TaskListCard, {
          tasks: [
            {
              id: 'task-1',
              content: '[plan] 分析 queryReportPartialFields 代码结构，设计 period_value 支持方案',
              status: 'in_progress',
              activeForm: '分析 queryReportPartialFields 代码结构，设计方案',
            },
          ],
        }),
      ),
    )

    assert.match(html, /class="task-list"/u)
    assert.doesNotMatch(html, /class="task-card"/u)
    assert.match(html, /class="task-process-row"/u)
    assert.match(html, /class="task-row task-in_progress process-row-summary"/u)
    assert.match(html, /aria-expanded="false"/u)
    assert.match(html, /lucide-list-todo/u)
    assert.match(html, /lucide-chevron-right/u)
    assert.match(html, /class="task-row-heading"/u)
    assert.match(html, /class="task-row-label"[^>]*>Task</u)
    assert.match(html, /class="task-row-role-text"[^>]*>plan</u)
    assert.match(
      html,
      /class="task-row-preview"[^>]*>分析 queryReportPartialFields 代码结构，设计方案</u,
    )
    assert.doesNotMatch(html, /class="task-row-role(?:\s|"| role-)/u)
    assert.ok(html.indexOf('>Task<') < html.indexOf('>plan<'))
    assert.ok(html.indexOf('>plan<') < html.indexOf('分析 queryReportPartialFields 代码结构，设计方案'))
    assert.doesNotMatch(html, /分析 queryReportPartialFields 代码结构，设计 period_value 支持方案/u)
  })

  it('keeps only the Task heading in the open summary and moves full content below it', () => {
    const TaskProcessRow = (
      TaskListModule as typeof TaskListModule & {
        TaskProcessRow?: React.ComponentType<{
          task: TaskListModule.TaskItem
          open: boolean
          onToggle: (open: boolean) => void
        }>
      }
    ).TaskProcessRow

    assert.equal(typeof TaskProcessRow, 'function')
    if (!TaskProcessRow) return

    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { serverLocale: 'en' },
        createElement(TaskProcessRow, {
          task: {
            id: 'task-1',
            content: '[plan] 分析 queryReportPartialFields 代码结构，设计 period_value 支持方案',
            status: 'in_progress',
            activeForm: '分析 queryReportPartialFields 代码结构，设计方案',
          },
          open: true,
          onToggle: () => undefined,
        }),
      ),
    )

    assert.match(html, /class="task-process-row is-open"/u)
    assert.match(html, /aria-expanded="true"/u)
    assert.match(html, /class="task-row-label"[^>]*>Task</u)
    assert.match(html, /class="task-row-role-text"[^>]*>plan</u)
    assert.doesNotMatch(html, /class="task-row-preview"/u)
    assert.doesNotMatch(html, /分析 queryReportPartialFields 代码结构，设计方案/u)
    assert.match(html, /class="task-row-detail process-collapse-body"/u)
    assert.match(html, /分析 queryReportPartialFields 代码结构，设计 period_value 支持方案/u)
  })
})
