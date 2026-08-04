import React from 'react'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n/I18nProvider.js'
import { nextPermissionMode, PermissionModeAction } from './PermissionModeAction.js'

function render(mode: 'default' | 'auto', saving = false) {
  return renderToStaticMarkup(
    <I18nProvider serverLocale="zh">
      <PermissionModeAction mode={mode} saving={saving} onChange={() => {}} />
    </I18nProvider>,
  )
}

function renderWithFeedback() {
  return renderToStaticMarkup(
    <I18nProvider serverLocale="zh">
      <PermissionModeAction
        mode="auto"
        pendingApprovalCount={2}
        failureCount={1}
        onChange={() => {}}
      />
    </I18nProvider>,
  )
}

describe('PermissionModeAction', () => {
  it('uses ShieldUser for default and exposes the off state', () => {
    const html = render('default')
    assert.match(html, /lucide-shield-user/u)
    assert.match(html, /权限自动接受：关/u)
    assert.match(html, /aria-pressed="false"/u)
  })

  it('uses the warning-state ShieldCheck class for auto', () => {
    const html = render('auto')
    assert.match(html, /lucide-shield-check/u)
    assert.match(html, /permission-mode-action is-auto/u)
    assert.match(html, /权限自动接受：开/u)
    assert.match(html, /aria-pressed="true"/u)
    const css = readFileSync(new URL('../styles/03-composer.css', import.meta.url), 'utf8')
    assert.match(
      css,
      /\.permission-mode-action\.is-auto\s*\{[^}]*color:\s*var\(--warn\);[^}]*background:\s*var\(--warn-soft\);/su,
    )
  })

  it('associates the default button with its scope description', () => {
    const html = render('default')
    const describedBy = html.match(/aria-describedby="([^"]+)"/u)?.[1]

    assert.ok(describedBy)
    assert.match(html, new RegExp(`id="${describedBy}"[^>]*role="tooltip"`, 'u'))
    assert.match(html, />当前 Session：默认权限</u)
    assert.match(
      html,
      />仅修改当前 Session；Agent 自行处理直通操作，其发出的权限请求需要人工审批。<\/span>/u,
    )
    assert.doesNotMatch(html, /\stitle=/u)
  })

  it('describes automatic acceptance when auto mode is active', () => {
    const html = render('auto')

    assert.match(html, /role="tooltip"/u)
    assert.match(html, />当前 Session：自动授权</u)
    assert.match(
      html,
      />仅修改当前 Session；立即放行当前待审批请求，并实时自动接受后续由 Agent 发出的 ACP 权限请求。Agent 直通操作仍由 Agent 自身策略处理。<\/span>/u,
    )
  })

  it('disables repeated activation while saving', () => {
    assert.match(render('auto', true), /disabled=""/u)
  })

  it('exposes Session pending and failed counts in the shield tooltip', () => {
    const html = renderWithFeedback()
    assert.match(html, /仍有 2 个待审批请求/u)
    assert.match(html, /1 个审批解析失败，可重试/u)
    assert.match(html, /permission-mode-tooltip-feedback/u)
  })

  it('toggles only between the two supported modes', () => {
    assert.equal(nextPermissionMode('default'), 'auto')
    assert.equal(nextPermissionMode('auto'), 'default')
  })
})
