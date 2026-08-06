import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ApprovalItem } from '@swarmdesk-agent/shared'

import { I18nProvider } from '../i18n/I18nProvider.js'
import { ApprovalActions } from './ApprovalActions.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const approval: ApprovalItem = {
  id: 'approval-cancel',
  status: 'pending',
  title: 'Allow command?',
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
  ],
  source: 'acp',
  createdAt: '2026-07-14T01:00:00.000Z',
}

describe('ApprovalActions', () => {
  it('always renders explicit cancel without selecting an option', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <ApprovalActions
          approval={approval}
          surface="panel"
          resolving={{}}
          onResolve={() => undefined}
          variant="wireframe"
        />
      </I18nProvider>,
    )

    assert.match(html, />\[Cancel\]</u)
    assert.match(html, /class="btn btn-cancel"/u)
    assert.match(html, />\[Allow once\]</u)
    assert.match(html, />\[Reject\]</u)
  })

  it('localizes bracketed option labels with Always hint to match UI language', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="zh">
        <ApprovalActions
          approval={{
            ...approval,
            options: [
              { optionId: 'allow-always', name: 'Always Allow all Write', kind: 'allow_always' },
              { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          }}
          surface="chat"
          resolving={{}}
          onResolve={() => undefined}
        />
      </I18nProvider>,
    )

    assert.match(html, /\[始终允许\]/u)
    assert.match(html, /\[允许本次\]/u)
    assert.match(html, /\[拒绝\]/u)
    assert.match(html, /\[取消\]/u)
    assert.match(html, /「始终允许」的有效期由 Agent 决定/u)
    assert.match(html, /Agent 未提供可验证路径/u)
    assert.doesNotMatch(html, /Always Allow all Write|rawInput|rawOutput/u)
  })
})
