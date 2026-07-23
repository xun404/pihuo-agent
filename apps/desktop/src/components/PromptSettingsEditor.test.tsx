import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PROMPT_SETTINGS, normalizePromptSettings } from '@swarmdesk-agent/shared'
import { I18nProvider } from '../i18n/I18nProvider.js'
import { PromptSettingsEditor } from './PromptSettingsEditor.js'

describe('PromptSettingsEditor', () => {
  it('renders Leader and all six editable role defaults without a save button', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="zh">
        <PromptSettingsEditor
          prompts={normalizePromptSettings(DEFAULT_PROMPT_SETTINGS, 'zh')}
          saving={false}
          onChange={() => {}}
          onSave={async () => {}}
        />
      </I18nProvider>,
    )

    assert.match(html, /prompt-card/u)
    assert.match(html, /prompt-role-item/u)
    assert.match(html, /Leader/u)
    for (const label of ['通用', '规划', '编码', '审查', '测试', '调研']) {
      assert.match(html, new RegExp(label, 'u'))
    }
    assert.equal((html.match(/<textarea/gu) ?? []).length, 7)
    // 默认值与打包一致时不展示「恢复默认」；有改动才出现
    assert.equal((html.match(/恢复默认/gu) ?? []).length, 0)
    assert.match(html, /内置协议和工具约束/u)
    assert.doesNotMatch(html, /settings-save-btn/u)
    assert.doesNotMatch(html, />保存</u)
    assert.match(html, /prompt-role-preview/u)
  })

  it('renders English built-in defaults when UI locale is en', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <PromptSettingsEditor
          prompts={normalizePromptSettings(undefined, 'en')}
          saving={false}
          onChange={() => {}}
          onSave={async () => {}}
        />
      </I18nProvider>,
    )
    assert.match(html, /Understand the user goal accurately/u)
    assert.match(html, /As an implementation role/u)
    assert.equal((html.match(/Restore default/gu) ?? []).length, 0)
  })

  it('shows reset links only when a prompt differs from package defaults', () => {
    const dirty = normalizePromptSettings({
      ...DEFAULT_PROMPT_SETTINGS,
      leader: '自定义 Leader 提示词',
      roles: {
        ...DEFAULT_PROMPT_SETTINGS.roles,
        coder: '自定义编码提示词',
      },
    })
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="zh">
        <PromptSettingsEditor
          prompts={dirty}
          saving={false}
          onChange={() => {}}
          onSave={async () => {}}
        />
      </I18nProvider>,
    )
    assert.equal((html.match(/恢复默认/gu) ?? []).length, 2)
    assert.match(html, /prompt-reset-link/u)
    assert.match(html, /prompt-role-dirty/u)
  })
})
