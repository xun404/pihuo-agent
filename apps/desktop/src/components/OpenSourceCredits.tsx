/**
 * Collapsible open-source credits for Settings → About.
 */
import { memo, useCallback, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n/I18nProvider'
import { OPEN_SOURCE_CREDITS } from '../lib/open-source-credits'
import { Expandable } from './ui/Expandable'

export const OpenSourceCredits = memo(function OpenSourceCredits() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const toggle = useCallback(() => setOpen((v) => !v), [])
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    },
    [toggle],
  )

  return (
    <div className={`about-oss${open ? ' is-open' : ''}`}>
      <div
        className="about-oss-summary"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className="about-oss-title">{t('settings.ossTitle')}</span>
        <span className="about-oss-meta">
          {t('settings.ossCount', { count: OPEN_SOURCE_CREDITS.length })}
        </span>
        <span className={`about-oss-chevron${open ? ' is-open' : ''}`} aria-hidden>
          <ChevronRight size={14} />
        </span>
      </div>
      <Expandable open={open} className="about-oss-collapse" contentClassName="about-oss-body">
        <p className="about-oss-intro settings-muted">{t('settings.ossIntro')}</p>
        <ul className="about-oss-list">
          {OPEN_SOURCE_CREDITS.map((item) => (
            <li key={item.name} className="about-oss-item">
              <div className="about-oss-item-main">
                <a
                  className="about-oss-name"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {item.name}
                </a>
                <span className="about-oss-license mono">{item.license}</span>
              </div>
              <div className="about-oss-role">{item.role}</div>
            </li>
          ))}
        </ul>
      </Expandable>
    </div>
  )
})
