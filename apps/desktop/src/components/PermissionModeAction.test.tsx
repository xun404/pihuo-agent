import React from 'react'
import assert from 'node:assert/strict'
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

describe('PermissionModeAction', () => {
  it('uses ShieldUser for default and exposes the off state', () => {
    const html = render('default')
    assert.match(html, /lucide-shield-user/u)
    assert.match(html, /权限自动接受：关/u)
    assert.match(html, /aria-pressed="false"/u)
  })

  it('uses a blue ShieldCheck state for auto', () => {
    const html = render('auto')
    assert.match(html, /lucide-shield-check/u)
    assert.match(html, /permission-mode-action is-auto/u)
    assert.match(html, /权限自动接受：开/u)
    assert.match(html, /aria-pressed="true"/u)
  })

  it('associates the default button with its scope description', () => {
    const html = render('default')
    const describedBy = html.match(/aria-describedby="([^"]+)"/u)?.[1]

    assert.ok(describedBy)
    assert.match(html, new RegExp(`id="${describedBy}"[^>]*role="tooltip"`, 'u'))
    assert.match(html, />默认权限</u)
    assert.match(html, />项目内操作直接执行，项目外变更需要审批</u)
    assert.doesNotMatch(html, /\stitle=/u)
  })

  it('describes automatic acceptance when auto mode is active', () => {
    const html = render('auto')

    assert.match(html, /role="tooltip"/u)
    assert.match(html, />自动授权</u)
    assert.match(html, />所有权限请求自动接受</u)
  })

  it('disables repeated activation while saving', () => {
    assert.match(render('auto', true), /disabled=""/u)
  })

  it('toggles only between the two supported modes', () => {
    assert.equal(nextPermissionMode('default'), 'auto')
    assert.equal(nextPermissionMode('auto'), 'default')
  })
})
