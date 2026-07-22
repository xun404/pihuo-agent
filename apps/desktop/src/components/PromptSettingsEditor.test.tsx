import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PROMPT_SETTINGS, normalizePromptSettings } from '@swarmdesk-agent/shared'
import { I18nProvider } from '../i18n/I18nProvider.js'
import { PromptSettingsEditor } from './PromptSettingsEditor.js'

describe('PromptSettingsEditor', () => {
  it('renders Leader and all six editable role defaults with reset and save actions', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="zh">
        <PromptSettingsEditor
          prompts={normalizePromptSettings(DEFAULT_PROMPT_SETTINGS)}
          saving={false}
          onChange={() => {}}
          onSave={async () => {}}
        />
      </I18nProvider>,
    )

    assert.match(html, /Leader/u)
    for (const label of ['通用', '规划', '编码', '审查', '测试', '调研']) {
      assert.match(html, new RegExp(`>${label}<`, 'u'))
    }
    assert.equal((html.match(/<textarea/gu) ?? []).length, 7)
    assert.equal((html.match(/恢复默认/gu) ?? []).length, 7)
    assert.match(html, /内置协议和工具约束/u)
    assert.match(html, /保存提示词/u)
  })
})
