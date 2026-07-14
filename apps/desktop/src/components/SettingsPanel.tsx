import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import {
  fetchSettings,
  saveSettings,
  deleteSecret,
  THINKING_INTENSITY_OPTIONS,
  DEFAULT_CUSTOM_THINKING_SUPPORT,
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
import { ProviderLogo, getProviderIconMeta } from '../lib/provider-icons'

type TabId = 'model' | 'gateway' | 'runtime' | 'about'

interface Props {
  open: boolean
  onClose: () => void
}

const TAG_ZH: Record<string, string> = {
  flagship: '旗舰',
  fast: '快速',
  coding: '编程',
  cheap: '省钱',
  reasoning: '推理',
}

const TAG_EN: Record<string, string> = {
  flagship: 'Flagship',
  fast: 'Fast',
  coding: 'Coding',
  cheap: 'Value',
  reasoning: 'Reason',
}

/** Simple form state — OpenAI-compatible gateway, no env var clutter */
type SimpleCustomForm = {
  name: string
  baseURL: string
  apiStyle: NonNullable<CustomProvider['apiStyle']>
  model: string
  apiKey: string
  contextWindow: string
  /** Supported thinking levels for this gateway */
  thinkingIntensities: ThinkingIntensity[]
  showAdvanced: boolean
}

const emptySimpleForm = (): SimpleCustomForm => ({
  name: '',
  baseURL: '',
  apiStyle: 'openai',
  model: '',
  apiKey: '',
  contextWindow: '',
  thinkingIntensities: [...DEFAULT_CUSTOM_THINKING_SUPPORT],
  showAdvanced: false,
})

function formatCtx(n?: number): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function SettingsPanel({ open, onClose }: Props) {
  const { t, locale } = useI18n()
  const [tab, setTab] = useState<TabId>('model')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [leaderModel, setLeaderModel] = useState('')
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({})
  const [showKey, setShowKey] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([])
  const [form, setForm] = useState<SimpleCustomForm>(emptySimpleForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Explicit provider selection (sidebar); falls back from leaderModel */
  const [focusProviderId, setFocusProviderId] = useState<string | null>(null)
  const [leaderMaxSteps, setLeaderMaxSteps] = useState<number | null>(null)
  const [leaderMaxStepsDraft, setLeaderMaxStepsDraft] = useState<string>('')
  const [leaderMaxStepsError, setLeaderMaxStepsError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await fetchSettings()
      setData(s)
      setLeaderModel(s.settings.leaderModel)
      setDraftKeys({})
      const customs = s.customProviders ?? s.settings.customProviders ?? []
      setCustomProviders(customs)
      const known = s.providers.some((p) => p.models.some((m) => m.id === s.settings.leaderModel))
      setCustomModel(!known)
      const fromModel =
        s.providers.find((p) => p.models.some((m) => m.id === s.settings.leaderModel)) ??
        s.providers.find((p) => s.settings.leaderModel.startsWith(`${p.id}/`)) ??
        s.providers[0]
      setFocusProviderId(fromModel?.id ?? null)
      const steps = s.leaderMaxSteps ?? s.settings.leaderMaxSteps ?? 500
      setLeaderMaxSteps(steps)
      setLeaderMaxStepsDraft(String(steps))
      setLeaderMaxStepsError(null)
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
      setShowKey(false)
      setLeaderMaxStepsError(null)
      void load()
    }
  }, [open, load])

  const selectedProvider: SettingsProvider | undefined = useMemo(() => {
    if (!data) return undefined
    if (focusProviderId) {
      const hit = data.providers.find((p) => p.id === focusProviderId)
      if (hit) return hit
    }
    if (!leaderModel) return data.providers[0]
    return (
      data.providers.find((p) => p.models.some((m) => m.id === leaderModel)) ??
      data.providers.find((p) => leaderModel.startsWith(`${p.id}/`)) ??
      data.providers[0]
    )
  }, [leaderModel, data, focusProviderId])

  const needsKey = selectedProvider && !selectedProvider.configured
  const keyDraft = selectedProvider ? draftKeys[selectedProvider.apiKeyEnv] ?? '' : ''
  const keyDirty = Boolean(keyDraft && !keyDraft.includes('••••'))

  const modelLabel = useMemo(() => {
    if (!data || !leaderModel) return leaderModel || '—'
    for (const p of data.providers) {
      const m = p.models.find((x) => x.id === leaderModel)
      if (m) return m.label
    }
    return leaderModel
  }, [data, leaderModel])

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
        leaderMaxSteps: leaderMaxSteps ?? undefined,
        secrets: Object.keys(secrets).length ? secrets : undefined,
        customProviders,
      })
      setOkMsg(t('settings.saved'))
      setDraftKeys({})
      setShowKey(false)
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
    setFocusProviderId(p.id)
    setCustomModel(false)
    // Keep current model if it belongs to this provider; else first model
    const stays = p.models.some((m) => m.id === leaderModel)
    if (!stays) {
      const next = p.models[0]?.id ?? `${p.id}/`
      setLeaderModel(next)
    }
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
      thinkingIntensities:
        p.thinkingIntensities && p.thinkingIntensities.length > 0
          ? [...p.thinkingIntensities]
          : [...DEFAULT_CUSTOM_THINKING_SUPPORT],
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

    const id = editingId ?? slugProviderId(name, form.baseURL)
    const builtinIds = new Set(
      (data?.providers ?? []).filter((p) => !p.custom).map((p) => p.id),
    )
    if (builtinIds.has(id) && !editingId) {
      setError(t('settings.customIdTaken'))
      return
    }

    const apiKeyEnv = defaultApiKeyEnv(id)
    const modelId = buildModelId(id, modelInput)
    const modelLabelNext = shortModelName(modelId, id)
    const baseURL = form.baseURL.trim() || undefined
    const apiStyle = form.apiStyle ?? 'openai'
    const ctxRaw = form.contextWindow.trim()
    const contextWindow = ctxRaw && Number.isFinite(Number(ctxRaw)) ? Number(ctxRaw) : undefined

    const thinkingIntensities =
      form.thinkingIntensities.length > 0
        ? THINKING_INTENSITY_OPTIONS.filter((l) => form.thinkingIntensities.includes(l))
        : (['off'] as ThinkingIntensity[])

    const next: CustomProvider = {
      id,
      name,
      apiKeyEnv,
      baseURL,
      apiStyle,
      contextWindow,
      thinkingIntensities,
      models: [{ id: modelId, label: modelLabelNext, contextWindow }],
    }

    setCustomProviders((list) => {
      if (editingId) return list.map((p) => (p.id === editingId ? next : p))
      if (list.some((p) => p.id === id)) return list.map((p) => (p.id === id ? next : p))
      return [...list, next]
    })

    if (form.apiKey.trim() && !form.apiKey.includes('••••')) {
      setDraftKeys((d) => ({ ...d, [apiKeyEnv]: form.apiKey.trim() }))
    }

    setLeaderModel(modelId)
    setFocusProviderId(id)
    resetForm()
    setError(null)
    setOkMsg(t('settings.customDrafted'))
    setTab('model')
  }

  const removeCustom = (id: string) => {
    setCustomProviders((list) => list.filter((p) => p.id !== id))
    if (editingId === id) resetForm()
    if (focusProviderId === id) setFocusProviderId(null)
  }

  const validateSteps = (raw: string): number | null => {
    const s = raw.trim()
    if (!s) return null
    const n = Number(s)
    if (!Number.isFinite(n) || !Number.isInteger(n) || String(n) !== s) return null
    if (n < 10 || n > 1000) return null
    return n
  }

  const onSaveRuntime = async () => {
    const parsed = validateSteps(leaderMaxStepsDraft)
    if (parsed == null) {
      setLeaderMaxStepsError(t('settings.runtime.leaderMaxStepsError'))
      return
    }
    setSaving(true)
    setError(null)
    setOkMsg(null)
    setLeaderMaxStepsError(null)
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
        leaderMaxSteps: parsed,
        secrets: Object.keys(secrets).length ? secrets : undefined,
        customProviders,
      })
      setLeaderMaxSteps(parsed)
      setOkMsg(t('settings.runtime.saveSuccess'))
      setDraftKeys({})
      setShowKey(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleStepsChange = (value: string) => {
    setLeaderMaxStepsDraft(value)
    if (!value.trim()) {
      setLeaderMaxStepsError(null)
      return
    }
    const parsed = validateSteps(value)
    if (parsed == null) {
      setLeaderMaxStepsError(t('settings.runtime.leaderMaxStepsError'))
    } else {
      setLeaderMaxStepsError(null)
    }
  }

  if (!open) return null

  const tabs: { id: TabId; label: string }[] = [
    { id: 'model', label: t('settings.tabModel') },
    { id: 'gateway', label: t('settings.tabProviders') },
    { id: 'runtime', label: t('settings.tabRuntime') },
    { id: 'about', label: t('settings.tabAbout') },
  ]

  const tagText = (tag: string) =>
    locale === 'zh' ? (TAG_ZH[tag] ?? tag) : (TAG_EN[tag] ?? tag)

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings-modal settings-modal-v3">
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
            <div className="settings-model-layout">
              <aside className="settings-provider-rail" aria-label={t('settings.provider')}>
                <div className="settings-rail-label">{t('settings.provider')}</div>
                {data.providers.map((p) => {
                  const active = selectedProvider?.id === p.id
                  const meta = getProviderIconMeta(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`settings-rail-item${active ? ' active' : ''}`}
                      onClick={() => pickProvider(p)}
                    >
                      <span
                        className="settings-rail-icon"
                        style={{ background: `${meta.color}22` }}
                        aria-hidden
                      >
                        <ProviderLogo providerId={p.id} size={16} />
                      </span>
                      <span className="settings-rail-text">
                        <span className="settings-rail-name">{p.name}</span>
                        {p.custom && (
                          <span className="settings-rail-badge">{t('settings.customBadge')}</span>
                        )}
                      </span>
                      <span
                        className={`settings-rail-dot${p.configured ? ' on' : ''}`}
                        title={p.configured ? t('settings.configured') : t('settings.needKey')}
                      />
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="settings-rail-add"
                  onClick={() => setTab('gateway')}
                >
                  + {t('settings.addCustomProvider')}
                </button>
              </aside>

              <div className="settings-model-main">
                <div className="settings-active-bar">
                  <div>
                    <div className="settings-active-label">{t('settings.current')}</div>
                    <div className="settings-active-title">{modelLabel}</div>
                    <div className="settings-active-id mono">{leaderModel || '—'}</div>
                  </div>
                  <div className="settings-active-status">
                    {selectedProvider?.configured ? (
                      <span className="badge badge-green">{t('settings.keyReady')}</span>
                    ) : (
                      <span className="badge badge-warn">{t('settings.needKey')}</span>
                    )}
                  </div>
                </div>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3>{t('settings.pickModel')}</h3>
                    {selectedProvider?.docsUrl && (
                      <a
                        className="settings-link-inline"
                        href={selectedProvider.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('settings.modelDocs')} ↗
                      </a>
                    )}
                  </div>
                  <div className="settings-model-list" role="listbox" aria-label={t('settings.pickModel')}>
                    {(selectedProvider?.models ?? []).map((m) => {
                      const active = leaderModel === m.id
                      const tag = (m as { tag?: string }).tag
                      const ctx = formatCtx((m as { contextWindow?: number }).contextWindow)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={`settings-model-row${active ? ' active' : ''}`}
                          onClick={() => pickModel(m.id)}
                        >
                          <span className="settings-model-row-main">
                            <span className="settings-model-row-label">{m.label}</span>
                            {tag && (
                              <span className={`model-tag tag-${tag}`}>{tagText(tag)}</span>
                            )}
                          </span>
                          <span className="settings-model-row-meta">
                            {ctx && <span className="mono">{ctx} ctx</span>}
                            {active && <span className="settings-model-check" aria-hidden>✓</span>}
                          </span>
                        </button>
                      )
                    })}
                    {(selectedProvider?.models ?? []).length === 0 && (
                      <p className="settings-muted">{t('settings.customEmpty')}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm settings-model-custom-toggle"
                    onClick={() => setCustomModel((v) => !v)}
                  >
                    {customModel ? t('settings.hideCustom') : t('settings.showCustom')}
                  </button>
                  {customModel && (
                    <input
                      className="settings-input mono mt-8"
                      value={leaderModel}
                      onChange={(e) => {
                        setLeaderModel(e.target.value)
                        const prefix = e.target.value.split('/')[0]
                        if (prefix && data.providers.some((p) => p.id === prefix)) {
                          setFocusProviderId(prefix)
                        }
                      }}
                      placeholder="provider/model-name"
                      spellCheck={false}
                    />
                  )}
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3>
                      {t('settings.providerKey', {
                        provider: selectedProvider?.name ?? '—',
                      })}
                    </h3>
                  </div>
                  {selectedProvider?.configured && !keyDirty && !showKey ? (
                    <div className="key-status-row">
                      <span className="badge badge-green">{t('settings.keyReady')}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setShowKey(true)
                          if (selectedProvider) {
                            setDraftKeys((d) => ({
                              ...d,
                              [selectedProvider.apiKeyEnv]: '',
                            }))
                          }
                        }}
                      >
                        {t('settings.updateKey')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          selectedProvider && void onClearKey(selectedProvider.apiKeyEnv)
                        }
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
                              : t('settings.enterKey')
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
                </section>
              </div>
            </div>
          )}

          {data && !loading && tab === 'gateway' && (
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
                          {p.thinkingIntensities && p.thinkingIntensities.length > 0
                            ? ` · ${t('settings.thinking')}: ${p.thinkingIntensities.join('/')}`
                            : ''}
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
                          onClick={() => {
                            startEdit(p)
                          }}
                        >
                          {t('settings.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setLeaderModel(p.models[0]?.id ?? `${p.id}/`)
                            setFocusProviderId(p.id)
                            setTab('model')
                          }}
                        >
                          {t('settings.useGateway')}
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

                <div className="settings-field">
                  <span>{t('settings.thinkingSupport')}</span>
                  <p className="settings-field-hint">{t('settings.thinkingSupportHint')}</p>
                  <div className="think-support-grid" role="group" aria-label={t('settings.thinkingSupport')}>
                    {THINKING_INTENSITY_OPTIONS.map((level) => {
                      const checked = form.thinkingIntensities.includes(level)
                      return (
                        <label key={level} className={`think-support-chip${checked ? ' on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setForm((f) => {
                                const set = new Set(f.thinkingIntensities)
                                if (set.has(level)) set.delete(level)
                                else set.add(level)
                                const next = THINKING_INTENSITY_OPTIONS.filter((l) => set.has(l))
                                return {
                                  ...f,
                                  thinkingIntensities: next.length > 0 ? next : (['off'] as ThinkingIntensity[]),
                                }
                              })
                            }}
                          />
                          <span className="mono">{level}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

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

          {data && !loading && tab === 'runtime' && (
            <div className="settings-runtime-section">
              <h3>{t('settings.runtime.leaderMaxSteps')}</h3>
              <p className="settings-runtime-desc">
                {t('settings.runtime.leaderMaxStepsDesc')}
              </p>
              <div className="settings-runtime-field">
                <label htmlFor="runtime-steps-input">{t('settings.runtime.leaderMaxSteps')}</label>
                <input
                  id="runtime-steps-input"
                  type="number"
                  className={`settings-runtime-input${leaderMaxStepsError ? ' input-error' : ''}`}
                  min={10}
                  max={1000}
                  step={1}
                  value={leaderMaxStepsDraft}
                  onChange={(e) => handleStepsChange(e.target.value)}
                />
                {leaderMaxStepsError && (
                  <span className="settings-runtime-error">{leaderMaxStepsError}</span>
                )}
              </div>
              <div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={saving || leaderMaxStepsError != null || !leaderMaxStepsDraft.trim()}
                  onClick={() => void onSaveRuntime()}
                >
                  {saving ? t('app.loading') : t('settings.save')}
                </button>
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
              <p className="settings-muted">{t('settings.sourcesHint')}</p>
              <ul className="settings-links">
                <li>
                  <a href="https://mastra.ai/models" target="_blank" rel="noreferrer">
                    mastra.ai/models
                  </a>
                </li>
                <li>
                  <a href="https://models.dev/" target="_blank" rel="noreferrer">
                    models.dev
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
