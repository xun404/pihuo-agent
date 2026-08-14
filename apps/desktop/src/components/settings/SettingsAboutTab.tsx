import type { MessageKey } from '../../i18n/locales'
import type { SettingsPayload } from '../../lib/settings'
import { BrandLockup } from '../BrandLockup'
import { OpenSourceCredits } from '../OpenSourceCredits'

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

interface SettingsAboutTabProps {
  data: SettingsPayload
  t: Translate
}

/** Presentational About content; SettingsPanel keeps data loading ownership. */
export function SettingsAboutTab({ data, t }: SettingsAboutTabProps) {
  return (
    <div className="settings-about">
      <h2 className="settings-page-title">{t('settings.navAbout')}</h2>
      <p className="settings-page-desc">{t('settings.descAbout')}</p>
      <div className="settings-form-card about-card">
        <BrandLockup className="about-lockup brand-lockup" size={32} label={t('app.title')} />
        <div className="ver">Desktop · 0.1.0</div>
        <p>{t('settings.aboutBody')}</p>
        <p className="settings-muted" style={{ marginTop: 12 }}>
          {t('settings.securityHint', {
            storage: data.storage,
            platform:
              data.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : 'os'),
          })}
        </p>
        {data.storagePaths && (
          <div className="settings-mono" style={{ marginTop: 8 }}>
            <div>
              {t('settings.storageRoot')}: {data.storagePaths.root}
            </div>
          </div>
        )}
      </div>
      <div className="settings-form-card about-oss-card">
        <OpenSourceCredits />
      </div>
    </div>
  )
}
