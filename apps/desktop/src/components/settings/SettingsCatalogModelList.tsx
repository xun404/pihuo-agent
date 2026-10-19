import { memo, useEffect, useRef, useState } from 'react'
import type { SettingsProvider, ThinkingIntensity } from '../../lib/settings'
import { useI18n } from '../../i18n/I18nProvider'
import {
  formatModelContextLabel,
  MODEL_ROW_STRIDE_PX,
  modelListWindow,
} from './settings-model-window'

type CatalogModel = SettingsProvider['models'][number]

type Props = {
  models: readonly CatalogModel[]
  leaderModel: string
  providerThinking?: ThinkingIntensity[]
  saving: boolean
  onPickDefault: (id: string) => void
}

/**
 * Windowed catalog model cards. OpenCode Zen-class lists are ~90 models; mounting
 * all of them on a rail click is a ~500ms INP hit. Only the visible slice renders.
 */
export const SettingsCatalogModelList = memo(function SettingsCatalogModelList({
  models,
  leaderModel,
  providerThinking,
  saving,
  onPickDefault,
}: Props) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement | null>(null)
  const [win, setWin] = useState(() =>
    modelListWindow({
      count: models.length,
      scrollTop: 0,
      viewportHeight: 720,
      listOffset: 0,
    }),
  )

  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const scroller = root.closest('.settings-model-main')
    if (!(scroller instanceof HTMLElement)) return

    const update = () => {
      const rootRect = root.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const listOffset = rootRect.top - scrollerRect.top + scroller.scrollTop
      setWin(
        modelListWindow({
          count: models.length,
          scrollTop: scroller.scrollTop,
          viewportHeight: scroller.clientHeight,
          listOffset,
        }),
      )
    }

    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [models])

  if (models.length === 0) {
    return <p className="settings-muted">{t('settings.customEmpty')}</p>
  }

  const start = Math.min(win.start, models.length)
  const end = Math.min(Math.max(win.end, start), models.length)
  const stride = MODEL_ROW_STRIDE_PX
  const slice = models.slice(start, end)

  return (
    <div
      ref={listRef}
      className="settings-model-list is-windowed"
      role="listbox"
      aria-label={t('settings.pickModel')}
    >
      <div className="settings-model-list-spacer" style={{ height: start * stride }} aria-hidden />
      {slice.map((m) => {
        const active = leaderModel === m.id
        const ctx = formatModelContextLabel(m.contextWindow)
        const thinks = m.thinkingIntensities ?? providerThinking
        return (
          <div key={m.id} className={`model-card${active ? ' is-default' : ''}`}>
            <div className="model-card-head">
              <span className="m-mid">
                <span className="m-name">{m.label}</span>
                <span className="m-id">{m.id}</span>
              </span>
              <span className="meta">
                {m.toolCall && <span className="model-tag">{t('settings.modelTagTools')}</span>}
                {m.multimodal && (
                  <span className="model-tag">{t('settings.modelTagMultimodal')}</span>
                )}
                {ctx && <span className="ctx">{ctx}</span>}
                {thinks && thinks.length > 0 && (
                  <span className="think-tags">
                    {thinks.slice(0, 4).map((lv) => (
                      <span key={lv} className={lv === 'off' ? 'off' : ''}>
                        {lv}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </div>
            {!active && (
              <button
                type="button"
                className="set-default-btn"
                disabled={saving}
                onClick={() => onPickDefault(m.id)}
              >
                {t('settings.setDefaultModel')}
              </button>
            )}
          </div>
        )
      })}
      <div
        className="settings-model-list-spacer"
        style={{ height: Math.max(0, models.length - end) * stride }}
        aria-hidden
      />
    </div>
  )
})
