import type { WorkerRole } from '@pihuo-agent/shared'
import { en } from './catalogs/en.js'
import { zh } from './catalogs/zh.js'
import type { Dict, Locale, MessageKey } from './locale-types.js'
import { zhTW as zhTWRaw } from './zh-TW.catalog.js'

export type { Locale, MessageKey } from './locale-types.js'

export const SUPPORTED_LOCALES: readonly Locale[] = ['zh', 'zh-TW', 'en'] as const

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'zh-TW' || value === 'en'
}

/** BCP 47 tag for Intl / HTML lang. */
export function localeToBcp47(locale: Locale): string {
  if (locale === 'zh') return 'zh-CN'
  if (locale === 'zh-TW') return 'zh-TW'
  return 'en'
}

/** True for any Chinese UI locale (simplified or traditional). */
export function isChineseLocale(locale: string): boolean {
  return locale === 'zh' || locale === 'zh-TW' || locale.startsWith('zh')
}

const zhTW = zhTWRaw as Dict
// Keep npm placeholder in sync after OpenCC generation (generator copies simplified zh).
zhTW['settings.runtime.npmRegistryPh'] = '留空使用系統預設'
zhTW['settings.runtime.npmRegistryUpdated'] = 'npm 鏡像已更新。'
zhTW['workers.registryPrepareLogTitle'] = '準備日誌'
zhTW['workers.registryPrepareStageResolving'] = '正在解析安裝計畫…'
zhTW['workers.registryPrepareStageFetchingIcon'] = '正在取得圖示…'
zhTW['workers.registryPrepareStageDownloading'] = '正在下載安裝包…'
zhTW['workers.registryPrepareStageInstalling'] = '正在安裝依賴…'
zhTW['workers.registryPrepareStageFinalizing'] = '正在寫入安裝記錄…'
zhTW['workers.registryPrepareStageAuthenticating'] = '正在認證…'

export const catalogs: Record<Locale, Dict> = { zh, 'zh-TW': zhTW, en }

export function roleMessageKey(role: WorkerRole): MessageKey {
  return `role.${role}` as MessageKey
}

export function formatMessage(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))
}

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh'
  const lang = navigator.language.toLowerCase()
  if (lang === 'zh-tw' || lang === 'zh-hk' || lang === 'zh-mo' || lang.startsWith('zh-hant')) {
    return 'zh-TW'
  }
  if (lang.startsWith('zh')) return 'zh'
  return 'en'
}
