import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import {
  fetchSettings,
  saveSettings,
  deleteSecret,
  THINKING_INTENSITY_OPTIONS,
  type SettingsPayload,
  type SettingsProvider,
  type CustomProvider,
  type ThinkingIntensity,
} from '../lib/settings'
import {
  buildModelId,
  defaultApiKeyEnv,
  shortModelName,
  slugProviderId,
} from '../lib/custom-provider-form'
import { getProviderIcon } from '../lib/provider-icons'

type TabId = 'model' | 'providers' | 'about'

interface Props {
  open: boolean
  onClose: () => void
}

const TAG_LABEL: Record<string, string> = {
  flagship: 'Flagship',
  fast: 'Fast',
  coding: 'Coding',
  cheap: 'Value',
  reasoning: 'Reason',
}

/** Simple form state — OpenCode-like, no env var / id clutter */
type SimpleCustomForm = {
  name: string
  baseURL: string
  apiStyle: NonNullable<CustomProvider['apiStyle']>
  model: string
  apiKey: string
  contextWindow: string
  showAdvanced: boolean
}

const emptySimpleForm = (): SimpleCustomForm => ({
  name: '',
  baseURL: '',
  apiStyle: 'openai',
  model: '',
  apiKey: '',
  contextWindow: '',
  showAdvanced: false,
})

export function SettingsPanel({ open, onClose }: Props) {
  const { t, locale } = useI18n()
  const [tab, setTab] = useState<TabId>('model')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [leaderModel, setLeaderModel] = useState('')
  const [thinkingIntensity, setThinkingIntensity] = useState<ThinkingIntensity>('medium')
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({})
  const [showKey, setShowKey] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([])
  const [form, setForm] = useState<SimpleCustomForm>(emptySimpleForm())
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await fetchSettings()
      setData(s)
      setLeaderModel(s.settings.leaderModel)
      const ti = s.settings.thinkingIntensity
      setThinkingIntensity(
        ti && THINKING_INTENSITY_OPTIONS.includes(ti) ? ti : 'medium',
      )
      setDraftKeys({})
      const customs = s.customProviders ?? s.settings.customProviders ?? []
      setCustomProviders(customs)
      const known = s.providers.some((p) => p.models.some((m) => m.id === s.settings.leaderModel))
      setCustomModel(!known)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setTab('model')
      setOkMsg(null)
      setForm(emptySimpleForm())
      setEditingId(null)
      void load()
    }
  }, [open, load])

  const selectedProvider: SettingsProvider | undefined = useMemo(() => {
    if (!data) return undefined
    if (!leaderModel) return data.providers[0]
    return (
      data.providers.find((p) => p.models.some((m) => m.id === leaderModel)) ??
      data.providers.find((p) => leaderModel.startsWith(`${p.id}/`)) ??
      data.providers[0]
    )
  }, [leaderModel, data])

  const needsKey = selectedProvider && !selectedProvider.configured
  const keyDraft = selectedProvider ? draftKeys[selectedProvider.apiKeyEnv] ?? '' : ''

  const onSave = async () => {
    setSaving(true)
    setError(null)
    setOkMsg(null)
    try {
      const secrets: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(draftKeys)) {
        if (v.trim() === '') continue
        if (!v.includes('••••')) secrets[k] = v
      }
      if (selectedProvider && keyDraft && !keyDraft.includes('••••')) {
        secrets[selectedProvider.apiKeyEnv] = keyDraft
      }
      await saveSettings({
        leaderModel: leaderModel.trim(),
        thinkingIntensity,
        secrets: Object.keys(secrets).length ? secrets : undefined,
        customProviders,
      })
      setOkMsg(t('settings.saved'))
      setDraftKeys({})
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const onClearKey = async (envKey: string) => {
    setSaving(true)
    try {
      await deleteSecret(envKey)
      setDraftKeys((d) => {
        const n = { ...d }
        delete n[envKey]
        return n
      })
      await load()
      setOkMsg(t('settings.keyCleared'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const pickProvider = (p: SettingsProvider) => {
    const next = p.models[0]?.id ?? `${p.id}/`
    setLeaderModel(next)
    setCustomModel(false)
  }

  const pickModel = (id: string) => {
    setLeaderModel(id)
    setCustomModel(false)
  }

  const resetForm = () => {
    setForm(emptySimpleForm())
    setEditingId(null)
  }

  const startEdit = (p: CustomProvider) => {
    setEditingId(p.id)
    const mid = p.models[0]?.id ?? ''
    setForm({
      name: p.name,
      baseURL: p.baseURL ?? '',
      apiStyle: p.apiStyle ?? 'openai',
      model: shortModelName(mid, p.id) || p.models[0]?.label || '',
      apiKey: '',
      contextWindow: p.contextWindow != null ? String(p.contextWindow) : '',
      showAdvanced: false,
    })
  }

  const saveCustomForm = () => {
    const name = form.name.trim()
    const modelInput = form.model.trim()
    if (!name || !modelInput) {
      setError(t('settings.customRequired'))
      return
    }

    const id = editingId ?? slugProviderId(name)
    const builtinIds = new Set(
      (data?.providers ?? []).filter((p) => !p.custom).map((p) => p.id),
    )
    if (builtinIds.has(id) && !editingId) {
      setError(t('settings.customIdTaken'))
      return
    }

    const apiKeyEnv = defaultApiKeyEnv(id)
    const modelId = buildModelId(id, modelInput)
    const modelLabel = shortModelName(modelId, id)
    const baseURL = form.baseURL.trim() || undefined
    const apiStyle = form.apiStyle ?? 'openai'
    const ctxRaw = form.contextWindow.trim()
    const contextWindow = ctxRaw && Number.isFinite(Number(ctxRaw)) ? Number(ctxRaw) : undefined

    const next: CustomProvider = {
      id,
      name,
      apiKeyEnv,
      baseURL,
      apiStyle,
      contextWindow,
      models: [{ id: modelId, label: modelLabel, contextWindow }],
    }

    setCustomProviders((list) => {
      if (editingId) return list.map((p) => (p.id === editingId ? next : p))
      if (list.some((p) => p.id === id)) return list.map((p) => (p.id === id ? next : p))
      return [...list, next]
    })

    // Optional: store API key now so user need not switch to Model tab
    if (form.apiKey.trim() && !form.apiKey.includes('••••')) {
      setDraftKeys((d) => ({ ...d, [apiKeyEnv]: form.apiKey.trim() }))
    }

    // Prefer selecting this model after add
    setLeaderModel(modelId)
    resetForm()
    setError(null)
    setOkMsg(t('settings.customDrafted'))
  }

  const removeCustom = (id: string) => {
    setCustomProviders((list) => list.filter((p) => p.id !== id))
    if (editingId === id) resetForm()
  }

  if (!open) return null

  const tabs: { id: TabId; label: string }[] = [
    { id: 'model', label: t('settings.tabModel') },
    { id: 'providers', label: t('settings.tabProviders') },
    { id: 'about', label: t('settings.tabAbout') },
  ]

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings-modal settings-modal-v2">
        <div className="settings-head">
          <div>
            <h2>{t('settings.title')}</h2>
            <p className="settings-sub">{t('settings.subtitle')}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>

        <div className="settings-tabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {loading && <p className="settings-muted">{t('app.loading')}</p>}
          {error && <p className="settings-error">{error}</p>}
          {okMsg && <p className="settings-ok">{okMsg}</p>}

          {data && !loading && tab === 'model' && (
            <div className="settings-model-flow">
              <div className="settings-step">
                <div className="settings-step-num">1</div>
                <div className="settings-step-body">
                  <h3>{t('settings.pickProvider')}</h3>
                  <div className="provider-grid">
                    {data.providers.map((p) => {
                      const active = selectedProvider?.id === p.id
                      const icon = getProviderIcon(p.id)
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`provider-card${active ? ' active' : ''}`}
                          onClick={() => pickProvider(p)}
                        >
                          <span
                            className="provider-card-icon"
                            style={{ background: `${icon.color}22`, color: icon.color }}
                            aria-hidden
                          >
                            {icon.glyph}
                          </span>
                          <span className="provider-card-name">{p.name}</span>
                          {p.custom && (
                            <span className="provider-card-badge">{t('settings.customBadge')}</span>
                          )}
                          <span className={`provider-dot${p.configured ? ' on' : ''}`} />
                          <span className="provider-card-meta">
                            {p.configured ? t('settings.configured') : t('settings.needKey')}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-8"
                    onClick={() => setTab('providers')}
                  >
                    {t('settings.addCustomProvider')} →
                  </button>
                </div>
              </div>

              <div className="settings-step">
                <div className="settings-step-num">2</div>
                <div className="settings-step-body">
                  <h3>{t('settings.pickModel')}</h3>
                  <div className="model-grid">
                    {(selectedProvider?.models ?? []).map((m) => {
                      const active = leaderModel === m.id
                      const tag = (m as { tag?: string }).tag
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`model-card${active ? ' active' : ''}`}
                          onClick={() => pickModel(m.id)}
                        >
                          <span className="model-card-label">{m.label}</span>
                          {tag && (
                            <span className={`model-tag tag-${tag}`}>
                              {locale === 'zh'
                                ? ({
                                    flagship: '旗舰',
                                    fast: '快速',
                                    coding: '编程',
                                    cheap: '高性价比',
                                    reasoning: '推理',
                                  }[tag] ?? tag)
                                : TAG_LABEL[tag] ?? tag}
                            </span>
                          )}
                          <span className="model-card-id mono">{m.id}</span>
                          {(m as { contextWindow?: number }).contextWindow != null && (
                            <span className="model-card-id mono">
                              ctx {(m as { contextWindow?: number }).contextWindow}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-8"
                    onClick={() => setCustomModel((v) => !v)}
                  >
                    {customModel ? t('settings.hideCustom') : t('settings.showCustom')}
                  </button>
                  {customModel && (
                    <input
                      className="settings-input mono mt-8"
                      value={leaderModel}
                      onChange={(e) => setLeaderModel(e.target.value)}
                      placeholder="provider/model-name"
                    />
                  )}
                </div>
              </div>

              <div className="settings-step">
                <div className="settings-step-num">3</div>
                <div className="settings-step-body">
                  <h3>{t('settings.thinking')}</h3>
                  <p className="settings-muted">{t('settings.thinkingHint')}</p>
                  <div className="think-intensity-grid" role="group" aria-label={t('settings.thinking')}>
                    {THINKING_INTENSITY_OPTIONS.map((level) => {
                      const label =
                        level === 'off'
                          ? t('chat.think.off')
                          : level === 'low'
                            ? t('chat.think.low')
                            : level === 'medium'
                              ? t('chat.think.medium')
                              : level === 'high'
                                ? t('chat.think.high')
                                : t('chat.think.max')
                      return (
                        <button
                          key={level}
                          type="button"
                          className={`think-intensity-card${thinkingIntensity === level ? ' active' : ''}`}
                          onClick={() => setThinkingIntensity(level)}
                        >
                          <span className="think-intensity-label">{label}</span>
                          <span className="think-intensity-id mono">{level}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="settings-step">
                <div className="settings-step-num">4</div>
                <div className="settings-step-body">
                  <h3>
                    {t('settings.providerKey', {
                      provider: selectedProvider?.name ?? '—',
                    })}
                  </h3>
                  {selectedProvider?.configured && !keyDraft ? (
                    <div className="key-status-row">
                      <span className="badge badge-green">{t('settings.keyReady')}</span>
                      <span className="settings-mono">{selectedProvider.apiKeyEnv}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setDraftKeys((d) => ({
                            ...d,
                            [selectedProvider.apiKeyEnv]: '',
                          }))
                        }
                      >
                        {t('settings.updateKey')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void onClearKey(selectedProvider.apiKeyEnv)}
                      >
                        {t('settings.clear')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="settings-muted">
                        {needsKey ? t('settings.keyRequired') : t('settings.keyOptionalUpdate')}
                      </p>
                      <div className="key-input-row">
                        <input
                          type={showKey ? 'text' : 'password'}
                          className="settings-input"
                          autoComplete="off"
                          placeholder={
                            selectedProvider?.configured
                              ? '••••••••••••'
                              : selectedProvider?.apiKeyEnv
                          }
                          value={keyDraft}
                          onChange={(e) =>
                            selectedProvider &&
                            setDraftKeys((d) => ({
                              ...d,
                              [selectedProvider.apiKeyEnv]: e.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setShowKey((v) => !v)}
                        >
                          {showKey ? t('settings.hide') : t('settings.show')}
                        </button>
                        {selectedProvider?.configured && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void onClearKey(selectedProvider.apiKeyEnv)}
                          >
                            {t('settings.clear')}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {selectedProvider?.docsUrl && (
                    <a
                      className="settings-link"
                      href={selectedProvider.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('settings.modelDocs')} ↗
                    </a>
                  )}
                </div>
              </div>

              <div className="settings-summary">
                <div>
                  <span className="settings-muted">{t('settings.current')}</span>
                  <div className="mono settings-current-model">{leaderModel || '—'}</div>
                </div>
              </div>
            </div>
          )}

          {data && !loading && tab === 'providers' && (
            <div className="settings-custom-providers">
              <p className="settings-muted">{t('settings.customIntro')}</p>

              {customProviders.length === 0 ? (
                <p className="settings-muted">{t('settings.customEmpty')}</p>
              ) : (
                <div className="custom-provider-list">
                  {customProviders.map((p) => (
                    <div className="custom-provider-row" key={p.id}>
                      <div className="custom-provider-meta">
                        <strong>{p.name}</strong>
                        <span className="settings-mono">
                          {p.models[0]?.label || p.models[0]?.id || '—'}
                          {p.apiStyle && p.apiStyle !== 'openai' ? ` · ${p.apiStyle}` : ''}
                        </span>
                        {p.baseURL && (
                          <span className="settings-mono" title={p.baseURL}>
                            {p.baseURL}
                          </span>
                        )}
                      </div>
                      <div className="custom-provider-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => startEdit(p)}
                        >
                          {t('settings.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeCustom(p.id)}
                        >
                          {t('settings.remove')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="custom-provider-form">
                <h3>{editingId ? t('settings.editCustom') : t('settings.addCustomProvider')}</h3>

                <label className="settings-field">
                  <span>{t('settings.customName')}</span>
                  <input
                    className="settings-input"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={t('settings.customNamePh')}
                  />
                </label>

                <label className="settings-field">
                  <span>{t('settings.customBaseUrl')}</span>
                  <input
                    className="settings-input mono"
                    value={form.baseURL}
                    onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
                    placeholder="https://api.example.com/v1"
                  />
                  <span className="settings-field-hint">{t('settings.customBaseUrlHint')}</span>
                </label>

                <label className="settings-field">
                  <span>{t('settings.customApiStyle')}</span>
                  <div className="seg custom-style-seg">
                    {(
                      [
                        ['openai', t('settings.styleOpenai')],
                        ['anthropic', t('settings.styleAnthropic')],
                        ['google', t('settings.styleGoogle')],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={form.apiStyle === id ? 'active' : ''}
                        onClick={() => setForm((f) => ({ ...f, apiStyle: id }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="settings-field-hint">{t('settings.customApiStyleHint')}</span>
                </label>

                <label className="settings-field">
                  <span>{t('settings.customModelId')}</span>
                  <input
                    className="settings-input mono"
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder={t('settings.customModelPh')}
                  />
                  <span className="settings-field-hint">{t('settings.customModelHint')}</span>
                </label>

                <label className="settings-field">
                  <span>{t('settings.customApiKey')}</span>
                  <input
                    type="password"
                    className="settings-input"
                    autoComplete="off"
                    value={form.apiKey}
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                    placeholder={t('settings.customApiKeyPh')}
                  />
                  <span className="settings-field-hint">{t('settings.customApiKeyHint')}</span>
                </label>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setForm((f) => ({ ...f, showAdvanced: !f.showAdvanced }))}
                >
                  {form.showAdvanced ? t('settings.hideAdvanced') : t('settings.showAdvanced')}
                </button>

                {form.showAdvanced && (
                  <label className="settings-field">
                    <span>{t('settings.customContext')}</span>
                    <input
                      className="settings-input mono"
                      type="number"
                      min={0}
                      value={form.contextWindow}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, contextWindow: e.target.value }))
                      }
                      placeholder="128000"
                    />
                    <span className="settings-field-hint">{t('settings.customContextHint')}</span>
                  </label>
                )}

                <div className="custom-form-actions">
                  {editingId && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
                      {t('settings.cancelEdit')}
                    </button>
                  )}
                  <button type="button" className="btn btn-soft btn-sm" onClick={saveCustomForm}>
                    {editingId ? t('settings.updateCustom') : t('settings.addToList')}
                  </button>
                </div>
                <p className="settings-muted mt-8">{t('settings.customSaveHint')}</p>
              </div>
            </div>
          )}

          {data && !loading && tab === 'about' && (
            <div className="settings-about">
              <h3>{t('settings.security')}</h3>
              <p className="settings-muted">
                {t('settings.securityHint', {
                  storage: data.storage,
                  platform:
                    data.platform ??
                    (typeof navigator !== 'undefined' ? navigator.platform : 'os'),
                })}
              </p>
              {data.safeStorageAvailable != null && (
                <p className="settings-muted">
                  {data.safeStorageAvailable
                    ? t('settings.safeStorageOn')
                    : t('settings.safeStorageOff')}
                </p>
              )}
              {data.storagePath && <p className="settings-mono">{data.storagePath}</p>}
              <h3 className="mt-8">{t('settings.sources')}</h3>
              <ul className="settings-links">
                <li>
                  <a href="https://models.dev/" target="_blank" rel="noreferrer">
                    models.dev
                  </a>
                </li>
                <li>
                  <a href="https://ai-sdk.dev/" target="_blank" rel="noreferrer">
                    ai-sdk.dev
                  </a>
                </li>
                <li>
                  <a href="https://mastra.ai/models" target="_blank" rel="noreferrer">
                    mastra.ai/models
                  </a>
                </li>
              </ul>
            </div>
          )}
        </div>

        <div className="settings-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('settings.close')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || loading || !leaderModel.trim()}
            onClick={() => void onSave()}
          >
            {saving ? t('app.loading') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
