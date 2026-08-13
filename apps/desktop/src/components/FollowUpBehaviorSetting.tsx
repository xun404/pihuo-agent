import { useI18n } from '../i18n/I18nProvider'
import { useFollowUpBehavior } from '../hooks/useFollowUpBehavior'
import type { FollowUpBehavior } from '../lib/follow-up-behavior'
import { SettingsSelect } from './SettingsSelect'

/** General-settings control shared by all mounted ChatPanel coordinators. */
export function FollowUpBehaviorSetting() {
  const { t } = useI18n()
  const { followUpBehavior, setFollowUpBehavior } = useFollowUpBehavior()
  return (
    <div className="settings-row card-row">
      <div className="lbl-block">
        <div className="lbl">{t('settings.followUpBehavior')}</div>
        <div className="sub">{t('settings.followUpBehaviorDesc')}</div>
      </div>
      <SettingsSelect
        value={followUpBehavior}
        onChange={(value) => setFollowUpBehavior(value as FollowUpBehavior)}
        aria-label={t('settings.followUpBehavior')}
        options={[
          { value: 'queue', label: t('settings.followUpBehaviorQueue') },
          { value: 'steer', label: t('settings.followUpBehaviorSteer') },
        ]}
      />
    </div>
  )
}
