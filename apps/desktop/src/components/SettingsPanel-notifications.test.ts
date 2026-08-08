import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { catalogs } from '../i18n/locales.js'

const source = readFileSync(new URL('./SettingsPanel.tsx', import.meta.url), 'utf8')

describe('SettingsPanel notification section', () => {
  it('renders the notification section with all five toggles and a test button', () => {
    assert.match(source, /settings\.notifications\.title/u)
    assert.match(source, /aria-label=\{t\('settings\.notifications\.enabled'\)\}/u)
    assert.match(source, /aria-label=\{t\('settings\.notifications\.mode'\)\}/u)
    assert.match(source, /aria-label=\{t\('settings\.notifications\.onCompletion'\)\}/u)
    assert.match(source, /aria-label=\{t\('settings\.notifications\.onError'\)\}/u)
    assert.match(source, /aria-label=\{t\('settings\.notifications\.onApproval'\)\}/u)
    assert.match(source, /settings\.notifications\.test'\)\}/u)
  })

  it('disables the mode / event toggles and test button while notifications are off', () => {
    const start = source.indexOf('settings.notifications.title')
    assert.ok(start > 0)
    const block = source.slice(start, source.indexOf('settings-danger-zone', start))
    assert.ok(block.length > 0)
    // mode + onCompletion + onError + onApproval checkboxes and the test button
    assert.equal((block.match(/disabled=\{!notificationSettings\.enabled\}/gu) ?? []).length, 5)
  })

  it('persists every toggle through saveSettings with a notifications payload', () => {
    // Every toggle builds a full NotificationSettings from the current draft
    // and persists it through the shared saveSettings({ notifications }) path.
    assert.match(
      source,
      /saveNotifications\(\{[\s\S]*?\.\.\.notificationSettings,\n\s*enabled: e\.target\.checked,/u,
    )
    assert.match(
      source,
      /saveNotifications\(\{[\s\S]*?\.\.\.notificationSettings,\n\s*mode: e\.target\.checked \? 'always' : 'hidden-only',/u,
    )
    assert.match(
      source,
      /saveNotifications\(\{[\s\S]*?\.\.\.notificationSettings,\n\s*onCompletion: e\.target\.checked,/u,
    )
    assert.match(
      source,
      /saveNotifications\(\{[\s\S]*?\.\.\.notificationSettings,\n\s*onError: e\.target\.checked,/u,
    )
    assert.match(
      source,
      /saveNotifications\(\{[\s\S]*?\.\.\.notificationSettings,\n\s*onApproval: e\.target\.checked,/u,
    )
    assert.match(source, /saveSettings\(\{ notifications: next \}\)/u)
  })

  it('sends the test notification through the notify bridge with the brief payload', () => {
    assert.match(
      source,
      /window\.routerAgents\?\.notify\?\.show\(\{[\s\S]*?id: 'test-notification'[\s\S]*?settings\.notifications\.testBody[\s\S]*?\}\)/u,
    )
  })

  it('provides the notification labels in every locale catalog', () => {
    const expected: Record<
      string,
      Record<string, { zh: string; 'zh-TW': string; en: string }>
    > = {
      title: { zh: '通知', 'zh-TW': '通知', en: 'Notifications' },
      enabled: { zh: '启用系统通知', 'zh-TW': '啟用系統通知', en: 'Enable system notifications' },
      mode: {
        zh: '窗口聚焦时也显示通知',
        'zh-TW': '視窗聚焦時也顯示通知',
        en: 'Show notifications while the window is focused',
      },
      onCompletion: { zh: '会话完成时通知', 'zh-TW': '會話完成時通知', en: 'Notify on session completion' },
      onError: { zh: '会话失败时通知', 'zh-TW': '會話失敗時通知', en: 'Notify on session failure' },
      onApproval: {
        zh: '需要审批时通知',
        'zh-TW': '需要審批時通知',
        en: 'Notify when approval is needed',
      },
      test: { zh: '发送测试通知', 'zh-TW': '傳送測試通知', en: 'Send test notification' },
      testBody: {
        zh: '系统通知已就绪',
        'zh-TW': '系統通知已就緒',
        en: 'System notifications are ready',
      },
    }
    for (const [key, byLocale] of Object.entries(expected)) {
      for (const locale of ['zh', 'zh-TW', 'en'] as const) {
        assert.equal(
          catalogs[locale][`settings.notifications.${key}`],
          byLocale[locale],
          `${locale} ${key}`,
        )
      }
    }
  })
})
