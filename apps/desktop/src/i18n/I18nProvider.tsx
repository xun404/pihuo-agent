import {
  default as React,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Locale as SharedLocale } from '@router-agents/shared'
import { catalogs, detectLocale, formatMessage, type Locale, type MessageKey } from './locales'

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const STORAGE_KEY = 'router-agents.locale'

function readStoredLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'zh' || v === 'en') return v
  } catch {
    /* ignore */
  }
  return null
}

interface Props {
  children: ReactNode
  /** Locale from server snapshot when available */
  serverLocale?: SharedLocale | null
  onLocaleChange?: (locale: Locale) => void | Promise<void>
}

export function I18nProvider({ children, serverLocale, onLocaleChange }: Props) {
  const [locale, setLocaleState] = useState<Locale>(
    () => readStoredLocale() ?? serverLocale ?? detectLocale(),
  )

  useEffect(() => {
    if (serverLocale && !readStoredLocale()) {
      setLocaleState(serverLocale)
    }
  }, [serverLocale])

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next)
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
      void onLocaleChange?.(next)
    },
    [onLocaleChange],
  )

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const dict = catalogs[locale] ?? catalogs.zh
      const fallback = catalogs.zh[key] ?? key
      return formatMessage(dict[key] ?? fallback, vars)
    },
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
