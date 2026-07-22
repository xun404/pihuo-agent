import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type {
  CustomAcpLaunchKind,
  CustomAcpRegistrationInput,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import {
  fetchSettings,
  saveSettings,
  THINKING_INTENSITY_OPTIONS,
  DEFAULT_CUSTOM_THINKING_SUPPORT,
  type SettingsPayload,
  type SettingsProvider,
  type CustomProvider,
  type CustomModelEntry,
  type ApiStyle,
  type ThinkingIntensity,
} from '../lib/settings'
import {
  api,
  type RegistryAuthenticateResult,
  type RegistryOperationSnapshot,
  type RegistryPrepareResult,
} from '../lib/api'
import {
  buildModelId,
  defaultApiKeyEnv,
  shortModelName,
  slugProviderId,
} from '../lib/custom-provider-form'
import { ProviderLogo, getProviderIconMeta } from '../lib/provider-icons'
import { useTheme, type ColorPalette, type ThemeMode } from '../theme/ThemeProvider'
import { useSendShortcut } from '../hooks/useSendShortcut'
import type { SendShortcut } from '../lib/send-shortcut'
import { BrandLogo } from './BrandLogo'
import { Expandable } from './ui/Expandable'

const SETTINGS_TAB_EASE = [0.4, 0, 0.2, 1] as const

/**
 * 外观四选一：
 * - 跟随系统 → 浅色=经典冷灰，深色=暗色
 * - 经典 → 固定浅色冷灰
 * - 深色 → 固定暗色
 * - 暖色 → 固定浅色暖橙
 */
type AppearanceChoice = 'system' | 'classic' | 'dark' | 'warm'

function appearanceChoice(mode: ThemeMode, palette: ColorPalette): AppearanceChoice {
  if (mode === 'dark') return 'dark'
  if (mode === 'system') return 'system'
  // mode === 'light'
  return palette === 'warm' ? 'warm' : 'classic'
}

function applyAppearanceChoice(
  choice: AppearanceChoice,
  setMode: (m: ThemeMode) => void,
  setPalette: (p: ColorPalette) => void,
) {
  switch (choice) {
    case 'system':
      setMode('system')
      setPalette('classic') // 系统浅色走经典
      break
    case 'classic':
      setMode('light')
      setPalette('classic')
      break
    case 'warm':
      setMode('light')
      setPalette('warm')
      break
    case 'dark':
      setMode('dark')
      break
  }
}
import {
  IconChevronLeft,
  IconCpu,
  IconInfo,
  IconSettings,
  IconWorkers,
  WorkerBrandLogo,
} from './Icons'
import type { Locale } from '../i18n/locales'
import { formatContextWindow, parseContextWindow } from '../lib/context-window'
import { useToast } from './Toast'
import { WorkerRegistryCombobox } from './WorkerRegistryCombobox'
import {
  createWorkerDraftFromRegistry,
  resolveWorkerRegistrationRoute,
} from '../lib/worker-registry'
import { WorkerReadinessBadge } from './WorkerReadinessBadge'
import { WorkerPrepareProgress, pollRegistryOperationUntilTerminal } from './WorkerPrepareProgress'
import { RegistryAgentDetail } from './RegistryAgentDetail'
import { WorkerAuthTerminalModal } from './WorkerAuthTerminalModal'
import { useAcpRegistryCatalog } from '../hooks/useAcpRegistryCatalog'

type TabId = 'general' | 'model' | 'workers' | 'about'

interface Props {
  onClose: () => void
  /** Open a specific settings tab (e.g. deep-link from WORKER_AUTH_REQUIRED CTA). */
  initialTab?: TabId
  workers: WorkerRegistration[]
  onToggleWorker: (id: string, enabled: boolean) => void
  onHealthAllWorkers: () => void | Promise<unknown>
  onRegisterCustomAcpWorker: (body: CustomAcpRegistrationInput) => Promise<unknown>
  onRefreshSnapshot: () => void
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

/**
 * Simple form state — provider-level fields only (OpenAI-compatible gateway).
 * Model-level fields (id / contextWindow / thinkingIntensities) live on each
 * CustomModelEntry and are managed via the inline add-model form + model list,
 * NOT here. Saving the provider never overwrites the models[] array.
 */
type SimpleCustomForm = {
  name: string
  baseURL: string
  apiStyle: NonNullable<CustomProvider['apiStyle']>
  apiKey: string
  /** Wireframe enable-control; default on */
  enabled: boolean
  showAdvanced: boolean
}

const emptySimpleForm = (): SimpleCustomForm => ({
  name: '',
  baseURL: '',
  apiStyle: 'openai',
  apiKey: '',
  enabled: true,
  showAdvanced: false,
})

/**
 * Inline "add model" form — model-level fields. Lives outside the provider
 * form because models are appended independently to provider.models[].
 */
type AddModelForm = {
  id: string
  contextWindow: string
  thinkingIntensities: ThinkingIntensity[]
}

const emptyAddModelForm = (): AddModelForm => ({
  id: '',
  contextWindow: '',
  thinkingIntensities: [...DEFAULT_CUSTOM_THINKING_SUPPORT],
})

function formatCtx(n?: number): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function SettingsPanel({
  onClose,
  initialTab,
  workers,
  onToggleWorker,
  onHealthAllWorkers,
  onRegisterCustomAcpWorker,
  onRefreshSnapshot,
}: Props) {
  const { t, locale, setLocale } = useI18n()
  const { mode: themeMode, setMode: setThemeMode, palette, setPalette } = useTheme()
  const { sendShortcut, setSendShortcut } = useSendShortcut()
  const reduceMotion = useReducedMotion()
  const tabMotion = {
    duration: reduceMotion ? 0.01 : 0.18,
    ease: SETTINGS_TAB_EASE,
  }
  const { success: toastSuccess, error: toastError } = useToast()
  const [tab, setTab] = useState<TabId>(initialTab ?? 'general')
  // Sync external tab changes (e.g. "管理模型" entry pinning 'model') even
  // when the panel is already open — useState initial value only fires on mount.
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])
  const [regOpen, setRegOpen] = useState(false)
  const [regName, setRegName] = useState('')
  const [regCommand, setRegCommand] = useState('')
  const [regArgs, setRegArgs] = useState('')
  const [regCustomLaunchKind, setRegCustomLaunchKind] = useState<CustomAcpLaunchKind>('system')
  const [regEnv, setRegEnv] = useState<Record<string, string>>({})
  const [regDescription, setRegDescription] = useState('')
  const [regSelectedId, setRegSelectedId] = useState<string | null>(null)
  const [regDistribution, setRegDistribution] = useState<'npx' | 'uvx' | 'binary'>('npx')
  const [regManifestDigest, setRegManifestDigest] = useState<string>('')
  const [regVersion, setRegVersion] = useState<string>('')
  const [regTrustNoSha, setRegTrustNoSha] = useState(false)
  const [regPrepareStatus, setRegPrepareStatus] = useState<string | null>(null)
  const [pendingRegistryPrepare, setPendingRegistryPrepare] = useState<{
    operation: RegistryOperationSnapshot<RegistryPrepareResult>
    registration: Omit<Parameters<typeof api.registerRegistryWorker>[0], 'installationId'>
  } | null>(null)
  const [regEnabled, setRegEnabled] = useState(true)
  const [regBusy, setRegBusy] = useState(false)
  const [terminalAuth, setTerminalAuth] = useState<{
    workerId: string
    workerName: string
    methodId: string
  } | null>(null)
  const [agentAuthOperation, setAgentAuthOperation] = useState<{
    workerId: string
    snapshot: RegistryOperationSnapshot<RegistryAuthenticateResult>
  } | null>(null)
  const agentAuthControllerRef = useRef<AbortController | null>(null)
  const [secretEditor, setSecretEditor] = useState<{
    workerId: string
    workerName: string
    envVarNames: string[]
  } | null>(null)
  const [secretBusy, setSecretBusy] = useState(false)
  const secretControllerRef = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [leaderModel, setLeaderModel] = useState('')
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({})

  const [customModel, setCustomModel] = useState(false)
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([])
  const [form, setForm] = useState<SimpleCustomForm>(emptySimpleForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Inline "add model" form (model-level fields), separate from provider form */
  const [addModelForm, setAddModelForm] = useState<AddModelForm>(emptyAddModelForm())
  const [showAddModel, setShowAddModel] = useState(false)
  /** Which model is expanded for inline editing (null = none) */
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  /** Inline edit-model form (mirrors AddModelForm fields) */
  const [editModelForm, setEditModelForm] = useState<AddModelForm>(emptyAddModelForm())
  /** Explicit provider selection (sidebar); falls back from leaderModel */
  const [focusProviderId, setFocusProviderId] = useState<string | null>(null)
  const [leaderMaxSteps, setLeaderMaxSteps] = useState<number | null>(null)
  const [leaderMaxStepsDraft, setLeaderMaxStepsDraft] = useState<string>('')
  const [leaderMaxStepsError, setLeaderMaxStepsError] = useState<string | null>(null)
  const [selectionStatus, setSelectionStatus] = useState<
    'featured' | 'not_featured' | 'registry_unknown' | null
  >(null)
  const {
    options: workerRegistry,
    loading: workerRegistryLoading,
    error: workerRegistryError,
  } = useAcpRegistryCatalog({
    enabled: regOpen,
    fetchCatalog: (signal, refresh) => api.getWorkerRegistry(signal, refresh),
  })

  const load = useCallback(async () => {
    setLoading(true)
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
      // Featured catalog: keep current selection visible + status chip
      try {
        const feat = await api.getModelsCatalog({
          featured: true,
          current: s.settings.leaderModel,
        })
        setSelectionStatus(feat.currentSelection?.status ?? null)
      } catch {
        setSelectionStatus(null)
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    setTab(initialTab ?? 'general')
    setForm(emptySimpleForm())
    setEditingId(null)
    setLeaderMaxStepsError(null)
    setRegOpen(false)
    void load()
  }, [load])

  useEffect(
    () => () => {
      agentAuthControllerRef.current?.abort()
      secretControllerRef.current?.abort()
    },
    [],
  )

  const selectedProvider: SettingsProvider | undefined = useMemo(() => {
    if (!data) return undefined
    if (focusProviderId && focusProviderId !== '__new__') {
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

  // When a custom provider is focused, keep the detail form hydrated (wireframe fields).
  useEffect(() => {
    if (!selectedProvider?.custom || focusProviderId === '__new__') return
    if (editingId === selectedProvider.id && form.name) return
    const cp = customProviders.find((c) => c.id === selectedProvider.id)
    if (cp) {
      startEdit(cp)
      return
    }
    setEditingId(selectedProvider.id)
    // Provider-level fields only — models are managed via the model list
    setForm({
      ...emptySimpleForm(),
      name: selectedProvider.name,
      baseURL: (selectedProvider as { baseURL?: string }).baseURL ?? '',
      apiStyle: (selectedProvider as { apiStyle?: ApiStyle }).apiStyle ?? 'openai',
    })
    // startEdit is stable enough for this hydration path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider?.id, selectedProvider?.custom, customProviders, focusProviderId])

  const needsKey = selectedProvider && !selectedProvider.configured
  const keyDraft = selectedProvider ? (draftKeys[selectedProvider.apiKeyEnv] ?? '') : ''

  const modelLabel = useMemo(() => {
    if (!data || !leaderModel) return leaderModel || '—'
    for (const p of data.providers) {
      const m = p.models.find((x) => x.id === leaderModel)
      if (m) return m.label
    }
    return leaderModel
  }, [data, leaderModel])

  /** After key save: refresh snapshot only. Keep sticky chat error until next send. */
  const afterSecretsSaved = async () => {
    onRefreshSnapshot()
  }

  const onSave = async () => {
    setSaving(true)
    try {
      const secrets: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(draftKeys)) {
        if (v.trim() === '') continue
        if (!v.includes('••••')) secrets[k] = v
      }
      if (selectedProvider && keyDraft && !keyDraft.includes('••••')) {
        secrets[selectedProvider.apiKeyEnv] = keyDraft
      }
      const secretsPayload = Object.keys(secrets).length ? secrets : undefined
      const saved = await saveSettings({
        leaderModel: leaderModel.trim(),
        leaderMaxSteps: leaderMaxSteps ?? undefined,
        secrets: secretsPayload,
        customProviders,
      })
      if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
      toastSuccess(secretsPayload ? t('settings.keySaved') : t('settings.saved'))
      setDraftKeys({})
      await load()
      if (secretsPayload) {
        await afterSecretsSaved()
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
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
    // Wireframe: custom provider detail shows 名称 / 接口类型 / Base URL
    if (p.custom) {
      const cp = customProviders.find((c) => c.id === p.id)
      if (cp) startEdit(cp)
      else {
        setEditingId(p.id)
        setForm({
          ...emptySimpleForm(),
          name: p.name,
          baseURL: '',
          apiStyle: 'openai',
        })
      }
    } else {
      resetForm()
    }
  }

  const workerLogoClass = (kind?: string) => {
    const k = (kind ?? '').toLowerCase()
    if (k === 'claude' || k.includes('claude')) return 'claude'
    if (k === 'codex' || k.includes('codex')) return 'codex'
    if (k === 'opencode' || k.includes('opencode')) return 'opencode'
    return 'custom'
  }

  const pickModel = (id: string) => {
    setLeaderModel(id)
    setCustomModel(false)
    void api
      .getModelsCatalog({ featured: true, current: id })
      .then((feat) => setSelectionStatus(feat.currentSelection?.status ?? null))
      .catch(() => setSelectionStatus(null))
  }

  const resetForm = () => {
    setForm(emptySimpleForm())
    setEditingId(null)
  }

  const startEdit = (p: CustomProvider) => {
    setEditingId(p.id)
    // Provider-level fields only — model-level fields live on each model entry
    setForm({
      name: p.name,
      baseURL: p.baseURL ?? '',
      apiStyle: p.apiStyle ?? 'openai',
      apiKey: '',
      enabled: p.enabled !== false,
      showAdvanced: false,
    })
  }

  /**
   * Build a CustomProvider from provider-level form fields.
   * CRITICAL: preserves the existing provider's models[] array — does NOT
   * overwrite it with a single model. Models are added/removed via the
   * dedicated add-model form / remove buttons, not via the provider save.
   *
   * For a brand-new provider (editingId === null), at least one model must
   * already be staged (via the add-model form) — enforced here.
   */
  const buildCustomFromForm = (): CustomProvider | null => {
    const name = form.name.trim()
    if (!name) {
      toastError(t('settings.customRequired'))
      return null
    }

    const id = editingId ?? slugProviderId(name, form.baseURL)
    const builtinIds = new Set((data?.providers ?? []).filter((p) => !p.custom).map((p) => p.id))
    if (builtinIds.has(id) && !editingId) {
      toastError(t('settings.customIdTaken'))
      return null
    }

    // Preserve existing models when editing; for new providers, require ≥1 staged model.
    const existing = editingId
      ? customProviders.find((c) => c.id === editingId)
      : customProviders.find((c) => c.id === id)
    const models = existing?.models ?? []
    if (models.length === 0) {
      toastError(t('settings.customModelRequired'))
      return null
    }

    const apiKeyEnv = existing?.apiKeyEnv ?? defaultApiKeyEnv(id)
    const baseURL = form.baseURL.trim() || undefined
    const apiStyle = form.apiStyle ?? 'openai'

    return {
      id,
      name,
      apiKeyEnv,
      baseURL,
      apiStyle,
      enabled: form.enabled,
      models,
    }
  }

  /** Build a CustomModelEntry from the inline add-model form. */
  const buildModelFromAddForm = (providerId: string): CustomModelEntry | null => {
    const idRaw = addModelForm.id.trim()
    if (!idRaw) {
      toastError(t('settings.customModelRequired'))
      return null
    }
    const modelId = buildModelId(providerId, idRaw)
    const contextWindow = parseContextWindow(addModelForm.contextWindow) ?? undefined
    const thinkingIntensities =
      addModelForm.thinkingIntensities.length > 0
        ? THINKING_INTENSITY_OPTIONS.filter((l) => addModelForm.thinkingIntensities.includes(l))
        : (['off'] as ThinkingIntensity[])
    return {
      id: modelId,
      label: shortModelName(modelId, providerId) || idRaw,
      contextWindow,
      thinkingIntensities,
    }
  }

  /** Append a model to the active provider's models[] (dedupe by id), then persist. */
  const addModelToActiveProvider = async () => {
    const providerId =
      editingId ?? (form.name.trim() ? slugProviderId(form.name.trim(), form.baseURL) : null)
    if (!providerId) {
      toastError(t('settings.customRequired'))
      return
    }
    const entry = buildModelFromAddForm(providerId)
    if (!entry) return

    // Dedupe: if model id already exists, refuse
    const existing = customProviders.find((c) => c.id === providerId)
    if (existing?.models.some((m) => m.id === entry.id)) {
      toastError(t('settings.customModelTaken'))
      return
    }

    setSaving(true)
    try {
      const nextList = existing
        ? customProviders.map((c) =>
            c.id === providerId ? { ...c, models: [...c.models, entry] } : c,
          )
        : [
            ...customProviders,
            {
              id: providerId,
              name: form.name.trim(),
              apiKeyEnv: defaultApiKeyEnv(providerId),
              baseURL: form.baseURL.trim() || undefined,
              apiStyle: form.apiStyle ?? 'openai',
              enabled: form.enabled,
              models: [entry],
            } satisfies CustomProvider,
          ]
      setCustomProviders(nextList)
      // Persist immediately so the new model survives a provider-form save later
      const secrets: Record<string, string | null> = { ...draftKeys }
      if (form.apiKey.trim() && !form.apiKey.includes('••••')) {
        secrets[defaultApiKeyEnv(providerId)] = form.apiKey.trim()
      }
      const saved = await saveSettings({
        leaderModel: entry.id,
        leaderMaxSteps: leaderMaxSteps ?? undefined,
        secrets: Object.keys(secrets).length ? secrets : undefined,
        customProviders: nextList,
      })
      if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
      setLeaderModel(entry.id)
      setAddModelForm(emptyAddModelForm())
      setShowAddModel(false)
      setEditingId(providerId)
      setForm((f) => ({ ...f, apiKey: '' }))
      toastSuccess(t('settings.customModelAdded'))
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /** Remove a model from the active provider's models[] and persist. */
  const removeModelFromActiveProvider = async (modelId: string) => {
    const providerId = editingId
    if (!providerId) return
    const existing = customProviders.find((c) => c.id === providerId)
    if (!existing) return
    // Refuse to delete the last model — a provider needs ≥1
    if (existing.models.length <= 1) {
      toastError(t('settings.customModelLast'))
      return
    }
    setSaving(true)
    try {
      const nextList = customProviders.map((c) =>
        c.id === providerId ? { ...c, models: c.models.filter((m) => m.id !== modelId) } : c,
      )
      setCustomProviders(nextList)
      // If we removed the active leaderModel, fall back to the first remaining
      const remaining = existing.models.filter((m) => m.id !== modelId)
      const nextLeader = leaderModel === modelId ? (remaining[0]?.id ?? leaderModel) : leaderModel
      const saved = await saveSettings({
        leaderModel: nextLeader,
        leaderMaxSteps: leaderMaxSteps ?? undefined,
        customProviders: nextList,
      })
      if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
      if (leaderModel === modelId) setLeaderModel(nextLeader)
      toastSuccess(t('settings.customModelRemoved'))
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /** Open inline edit for a model: load its current fields into editModelForm. */
  const beginEditModel = (model: CustomModelEntry) => {
    setEditingModelId(model.id)
    setShowAddModel(false)
    setEditModelForm({
      id: shortModelName(model.id, editingId ?? '') || model.label,
      contextWindow: formatContextWindow(model.contextWindow) ?? '',
      thinkingIntensities: [
        ...((model as { thinkingIntensities?: ThinkingIntensity[] }).thinkingIntensities ??
          DEFAULT_CUSTOM_THINKING_SUPPORT),
      ],
    })
  }

  const cancelEditModel = () => {
    setEditingModelId(null)
    setEditModelForm(emptyAddModelForm())
  }

  /** Persist edits to a model's contextWindow / thinkingIntensities (id unchanged). */
  const updateModelInActiveProvider = async () => {
    const providerId = editingId
    const modelId = editingModelId
    if (!providerId || !modelId) return
    const existing = customProviders.find((c) => c.id === providerId)
    if (!existing) return
    const target = existing.models.find((m) => m.id === modelId)
    if (!target) return

    setSaving(true)
    try {
      const contextWindow = parseContextWindow(editModelForm.contextWindow) ?? undefined
      const thinkingIntensities =
        editModelForm.thinkingIntensities.length > 0
          ? THINKING_INTENSITY_OPTIONS.filter((l) => editModelForm.thinkingIntensities.includes(l))
          : (['off'] as ThinkingIntensity[])
      const nextList = customProviders.map((c) =>
        c.id === providerId
          ? {
              ...c,
              models: c.models.map((m) =>
                m.id === modelId ? { ...m, contextWindow, thinkingIntensities } : m,
              ),
            }
          : c,
      )
      setCustomProviders(nextList)
      const saved = await saveSettings({
        leaderModel,
        leaderMaxSteps: leaderMaxSteps ?? undefined,
        customProviders: nextList,
      })
      if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
      cancelEditModel()
      toastSuccess(t('settings.customModelUpdated'))
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const saveCustomForm = () => {
    const next = buildCustomFromForm()
    if (!next) return

    setCustomProviders((list) => {
      if (editingId) return list.map((p) => (p.id === editingId ? next : p))
      if (list.some((p) => p.id === next.id)) return list.map((p) => (p.id === next.id ? next : p))
      return [...list, next]
    })

    if (form.apiKey.trim() && !form.apiKey.includes('••••')) {
      setDraftKeys((d) => ({ ...d, [next.apiKeyEnv]: form.apiKey.trim() }))
    }

    setLeaderModel(next.models[0]!.id)
    setFocusProviderId(next.id)
    setEditingId(next.id)
    toastSuccess(t('settings.customDrafted'))
    setTab('model')
  }

  /** Draft custom form into list, then persist (wireframe single 保存). */
  const saveCustomAndPersist = async () => {
    const next = buildCustomFromForm()
    if (!next) return

    let nextList: CustomProvider[]
    if (editingId) {
      nextList = customProviders.map((p) => (p.id === editingId ? next : p))
      if (!customProviders.some((p) => p.id === editingId)) nextList = [...customProviders, next]
    } else if (customProviders.some((p) => p.id === next.id)) {
      nextList = customProviders.map((p) => (p.id === next.id ? next : p))
    } else {
      nextList = [...customProviders, next]
    }

    const secrets: Record<string, string | null> = { ...draftKeys }
    if (form.apiKey.trim() && !form.apiKey.includes('••••')) {
      secrets[next.apiKeyEnv] = form.apiKey.trim()
    }
    // Drop masked placeholders
    const cleanSecrets: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(secrets)) {
      if (v && !String(v).includes('••••') && String(v).trim()) cleanSecrets[k] = String(v)
    }

    setSaving(true)
    try {
      setCustomProviders(nextList)
      setLeaderModel(next.models[0]!.id)
      setFocusProviderId(next.id)
      setEditingId(next.id)
      const secretsPayload = Object.keys(cleanSecrets).length ? cleanSecrets : undefined
      const saved = await saveSettings({
        leaderModel: next.models[0]!.id,
        leaderMaxSteps: leaderMaxSteps ?? undefined,
        secrets: secretsPayload,
        customProviders: nextList,
      })
      if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
      // Persist empty key field after save so user must re-type to rotate again
      setForm((f) => ({ ...f, apiKey: '' }))
      toastSuccess(secretsPayload ? t('settings.keySaved') : t('settings.saved'))
      setDraftKeys({})
      await load()
      if (secretsPayload) {
        await afterSecretsSaved()
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
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
      const secretsPayload = Object.keys(secrets).length ? secrets : undefined
      const saved = await saveSettings({
        leaderModel: leaderModel.trim(),
        leaderMaxSteps: parsed,
        secrets: secretsPayload,
        customProviders,
      })
      if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
      setLeaderMaxSteps(parsed)
      toastSuccess(secretsPayload ? t('settings.keySaved') : t('settings.runtime.saveSuccess'))
      setDraftKeys({})
      await load()
      if (secretsPayload) {
        await afterSecretsSaved()
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
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

  const navItems: { id: TabId; label: string }[] = [
    { id: 'general', label: t('settings.navGeneral') },
    { id: 'model', label: t('settings.navModel') },
    { id: 'workers', label: t('settings.navWorkers') },
    { id: 'about', label: t('settings.navAbout') },
  ]

  const tagText = (tag: string) => (locale === 'zh' ? (TAG_ZH[tag] ?? tag) : (TAG_EN[tag] ?? tag))

  const selectedRegistryOption = useMemo(
    () => workerRegistry.find((o) => o.id === regSelectedId) ?? null,
    [workerRegistry, regSelectedId],
  )
  const registrationRoute = resolveWorkerRegistrationRoute(
    regSelectedId,
    selectedRegistryOption,
    regManifestDigest,
  )
  const isRegistryPath = registrationRoute.kind !== 'custom'

  const startAgentAuthentication = async (workerId: string, methodId: string) => {
    if (agentAuthControllerRef.current) return
    const controller = new AbortController()
    agentAuthControllerRef.current = controller
    try {
      const created = await api.authenticateRegistryWorker(workerId, methodId, controller.signal)
      setAgentAuthOperation({ workerId, snapshot: created })
      const completed = await pollRegistryOperationUntilTerminal<RegistryAuthenticateResult>({
        operationId: created.operationId,
        signal: controller.signal,
        onSnapshot: (snapshot) => setAgentAuthOperation({ workerId, snapshot }),
      })
      setAgentAuthOperation(null)
      onRefreshSnapshot?.()
      const verifiedReadiness =
        completed.result?.worker.readiness?.status === 'ready' ||
        completed.result?.worker.readiness?.status === 'degraded'
      if (completed.status === 'succeeded' && verifiedReadiness) {
        toastSuccess(t('workers.authSucceeded'))
      } else if (completed.status === 'failed' || completed.status === 'succeeded') {
        const readiness = completed.result?.worker.readiness
        toastError(
          completed.code || readiness?.code
            ? `${completed.code ?? readiness?.code}: ${completed.error ?? readiness?.message ?? ''}`.trim()
            : (completed.error ?? readiness?.message ?? t('workers.authFailed')),
        )
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setAgentAuthOperation(null)
        toastError(error instanceof Error ? error.message : t('workers.authFailed'))
      }
    } finally {
      if (agentAuthControllerRef.current === controller) {
        agentAuthControllerRef.current = null
      }
    }
  }

  const cancelAgentAuthentication = async () => {
    const active = agentAuthOperation
    if (!active) return
    agentAuthControllerRef.current?.abort()
    try {
      await api.cancelRegistryOperation<RegistryAuthenticateResult>(active.snapshot.operationId)
    } catch {
      /* operation may already be terminal */
    }
    setAgentAuthOperation(null)
    onRefreshSnapshot?.()
  }

  const closeSecretEditor = () => {
    secretControllerRef.current?.abort()
    setSecretEditor(null)
  }

  const saveWorkerSecrets = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!secretEditor || secretBusy) return
    const form = event.currentTarget
    const controller = new AbortController()
    secretControllerRef.current = controller
    const values = new FormData(form)
    setSecretBusy(true)
    try {
      for (const envName of secretEditor.envVarNames) {
        const value = values.get(envName)
        if (typeof value !== 'string' || !value) continue
        await api.setWorkerSecret(secretEditor.workerId, envName, value, controller.signal)
      }
      await api.probeRegistryWorker(secretEditor.workerId, controller.signal)
      setSecretEditor(null)
      onRefreshSnapshot?.()
      toastSuccess(t('workers.authSucceeded'))
      form.reset()
    } catch (error) {
      if (!controller.signal.aborted) {
        toastError(error instanceof Error ? error.message : t('workers.authFailed'))
      }
    } finally {
      if (secretControllerRef.current === controller) secretControllerRef.current = null
      setSecretBusy(false)
    }
  }

  const resetWorkerRegistration = () => {
    setRegName('')
    setRegCommand('')
    setRegArgs('')
    setRegCustomLaunchKind('system')
    setRegEnv({})
    setRegDescription('')
    setRegSelectedId(null)
    setRegManifestDigest('')
    setRegVersion('')
    setRegTrustNoSha(false)
    setRegPrepareStatus(null)
    setPendingRegistryPrepare(null)
    setRegOpen(false)
    onRefreshSnapshot?.()
    toastSuccess(t('settings.saved'))
  }

  const finishRegistryRegistration = async (prepared: RegistryPrepareResult) => {
    const pending = pendingRegistryPrepare
    if (!pending) return
    setRegPrepareStatus(t('workers.registryRegistering'))
    try {
      await api.registerRegistryWorker({
        ...pending.registration,
        installationId: prepared.installationId,
      })
      resetWorkerRegistration()
    } catch (error) {
      setPendingRegistryPrepare(null)
      setRegPrepareStatus(null)
      setRegBusy(false)
      toastError(error instanceof Error ? error.message : String(error))
    }
  }

  const saveWorker = async () => {
    if (!regName.trim()) return
    setRegBusy(true)
    setRegPrepareStatus(null)
    setPendingRegistryPrepare(null)
    let operationStarted = false
    try {
      // Registry path: Owner prepare → register (never trust client command)
      if (registrationRoute.kind === 'registry_unavailable') {
        throw new Error(t('workers.registrySelectionUnavailable'))
      }
      if (registrationRoute.kind === 'registry') {
        const selectedRegistryOption = registrationRoute.option
        const dist = selectedRegistryOption.distributions?.includes(regDistribution)
          ? regDistribution
          : selectedRegistryOption.distribution
        const operation = await api.prepareRegistryAgent({
          registryId: selectedRegistryOption.id,
          version: regVersion || selectedRegistryOption.version,
          distribution: dist,
          manifestDigest: regManifestDigest,
          trust: regTrustNoSha
            ? {
                explicitNoSha: true,
                acceptedAt: new Date().toISOString(),
              }
            : undefined,
        })
        setPendingRegistryPrepare({
          operation,
          registration: {
            registryId: selectedRegistryOption.id,
            version: regVersion || selectedRegistryOption.version,
            distribution: dist,
            manifestDigest: regManifestDigest,
            name: regName.trim(),
            enabled: regEnabled,
          },
        })
        operationStarted = true
        return
      } else {
        // Custom / manual path
        if (!regCommand.trim()) return
        const args = regArgs.trim().split(/\s+/).filter(Boolean)
        await onRegisterCustomAcpWorker({
          name: regName.trim(),
          launchKind: regCustomLaunchKind,
          ...(regCustomLaunchKind === 'npx' || regCustomLaunchKind === 'uvx'
            ? { packageSpec: regCommand.trim() }
            : { command: regCommand.trim() }),
          args,
          env: Object.keys(regEnv).length > 0 ? regEnv : undefined,
          enabled: regEnabled,
          description: regDescription.trim() || undefined,
        })
      }
      resetWorkerRegistration()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
      setRegPrepareStatus(null)
    } finally {
      if (!operationStarted) setRegBusy(false)
    }
  }

  const body = (
    <div className="settings-body settings-page-body">
      {loading && <p className="settings-muted">{t('app.loading')}</p>}

      {!loading && tab === 'general' && (
        <div className="settings-general">
          <h2 className="settings-page-title">{t('settings.navGeneral')}</h2>
          <p className="settings-page-desc">{t('settings.descGeneral')}</p>
          <div className="settings-form-card">
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.appearance')}</div>
                <div className="sub">{t('settings.appearanceDesc')}</div>
              </div>
              <select
                className="field-select settings-select"
                style={{ minWidth: 140, width: 'auto' }}
                value={appearanceChoice(themeMode, palette)}
                onChange={(e) =>
                  applyAppearanceChoice(
                    e.target.value as AppearanceChoice,
                    setThemeMode,
                    setPalette,
                  )
                }
                aria-label={t('settings.appearance')}
              >
                <option value="system">{t('appearance.system')}</option>
                <option value="classic">{t('appearance.classic')}</option>
                <option value="dark">{t('appearance.dark')}</option>
                <option value="warm">{t('appearance.warm')}</option>
              </select>
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.language')}</div>
                <div className="sub">{t('settings.languageDesc')}</div>
              </div>
              <select
                className="field-select settings-select"
                style={{ minWidth: 140, width: 'auto' }}
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                aria-label={t('settings.language')}
              >
                <option value="zh">{t('lang.zh')}</option>
                <option value="en">{t('lang.en')}</option>
              </select>
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.sendShortcut')}</div>
                <div className="sub">{t('settings.sendShortcutDesc')}</div>
              </div>
              <select
                className="field-select settings-select"
                style={{ minWidth: 140, width: 'auto' }}
                value={sendShortcut}
                onChange={(e) => setSendShortcut(e.target.value as SendShortcut)}
                aria-label={t('settings.sendShortcut')}
              >
                <option value="enter">{t('settings.sendShortcutEnter')}</option>
                <option value="mod-enter">{t('settings.sendShortcutModEnter')}</option>
              </select>
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.runtime.leaderMaxSteps')}</div>
                <div className="sub">{t('settings.runtime.leaderMaxStepsDesc')}</div>
              </div>
              <input
                type="number"
                className="field-input settings-select"
                style={{ width: 100 }}
                min={10}
                max={1000}
                value={leaderMaxStepsDraft}
                onChange={(e) => handleStepsChange(e.target.value)}
                onBlur={() => {
                  if (leaderMaxStepsError == null && leaderMaxStepsDraft.trim()) {
                    void onSaveRuntime()
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && leaderMaxStepsError == null) {
                    e.preventDefault()
                    void onSaveRuntime()
                  }
                }}
                aria-label={t('settings.runtime.leaderMaxSteps')}
              />
            </div>
            {leaderMaxStepsError && <p className="settings-error">{leaderMaxStepsError}</p>}
          </div>
        </div>
      )}

      {data && !loading && tab === 'model' && (
        <div className="settings-model-page">
          <h2 className="settings-page-title">{t('settings.navModel')}</h2>
          <p className="settings-page-desc">{t('settings.descModel')}</p>
          <div className="settings-model-layout">
            <aside className="settings-provider-rail" aria-label={t('settings.provider')}>
              <div className="settings-rail-label">{t('settings.providerBuiltin')}</div>
              {data.providers
                .filter((p) => !p.custom)
                .map((p) => {
                  const active = selectedProvider?.id === p.id && focusProviderId !== '__new__'
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
                      </span>
                      <span
                        className={`settings-rail-dot${p.configured ? ' on' : ''}`}
                        title={p.configured ? t('settings.configured') : t('settings.needKey')}
                      />
                    </button>
                  )
                })}
              <div className="settings-rail-label" style={{ marginTop: 12 }}>
                {t('settings.providerCustom')}
              </div>
              {data.providers
                .filter((p) => p.custom)
                .map((p) => {
                  const active =
                    (selectedProvider?.id === p.id || editingId === p.id) &&
                    focusProviderId !== '__new__'
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
                className={`settings-rail-add${focusProviderId === '__new__' ? ' active' : ''}`}
                onClick={() => {
                  setEditingId(null)
                  setForm(emptySimpleForm())
                  setFocusProviderId('__new__')
                }}
              >
                + {t('settings.addProvider')}
              </button>
            </aside>

            <div className="settings-model-main">
              {focusProviderId === '__new__' || selectedProvider?.custom || editingId ? (
                <>
                  <div className="settings-provider-head">
                    <div className="pname">
                      {focusProviderId === '__new__'
                        ? t('settings.addProvider')
                        : form.name || selectedProvider?.name || t('settings.editCustom')}
                    </div>
                    {focusProviderId !== '__new__' && (
                      <button
                        type="button"
                        className={`enable-switch${form.enabled ? ' is-on' : ''}`}
                        role="switch"
                        aria-checked={form.enabled}
                        title={t('settings.enableProvider')}
                        aria-label={t('settings.enableProvider')}
                        onClick={() => {
                          const next = !form.enabled
                          setForm((f) => ({ ...f, enabled: next }))
                          if (editingId) {
                            setCustomProviders((list) =>
                              list.map((p) => (p.id === editingId ? { ...p, enabled: next } : p)),
                            )
                          }
                        }}
                      >
                        <span className="enable-switch-knob" aria-hidden />
                      </button>
                    )}
                    <span className="spacer" />
                    <button
                      type="button"
                      className="settings-save-btn"
                      disabled={saving}
                      onClick={() => void saveCustomAndPersist()}
                    >
                      {saving ? t('app.loading') : t('settings.save')}
                    </button>
                  </div>
                  <div className="settings-field">
                    <label>{t('settings.customName')}</label>
                    <input
                      className="settings-input"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder={t('settings.customNamePh')}
                    />
                    <span className="settings-field-hint">{t('settings.customNamePh')}</span>
                  </div>
                  <div className="settings-field">
                    <label>{t('settings.customBaseUrl')}</label>
                    <div className="settings-input-combo">
                      <input
                        className="settings-input mono settings-input-combo-main"
                        value={form.baseURL}
                        onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
                        placeholder="https://api.example.com/v1"
                        aria-label={t('settings.customBaseUrl')}
                      />
                      <select
                        className="settings-input-combo-select"
                        value={form.apiStyle}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            apiStyle: e.target.value as NonNullable<CustomProvider['apiStyle']>,
                          }))
                        }
                        aria-label={t('settings.customApiStyle')}
                      >
                        <option value="openai">{t('settings.styleOpenai')}</option>
                        <option value="anthropic">{t('settings.styleAnthropic')}</option>
                        <option value="google">{t('settings.styleGoogle')}</option>
                      </select>
                    </div>
                    <span className="settings-field-hint">
                      {t('settings.customBaseUrlHint')} · {t('settings.customApiStyleHint')}
                    </span>
                  </div>
                  <div className="settings-field">
                    <label>{t('settings.customApiKey')}</label>
                    <input
                      type="password"
                      className="settings-input"
                      autoComplete="off"
                      value={form.apiKey}
                      onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                      placeholder={
                        selectedProvider?.configured ? '***********' : t('settings.customApiKeyPh')
                      }
                    />
                    {selectedProvider?.configured && !form.apiKey.trim() && (
                      <span className="settings-field-hint">{t('settings.keyReplaceHint')}</span>
                    )}
                  </div>
                  {/* ===== 模型列表（每个模型独立：ID / 上下文 / 思考强度）===== */}
                  <section className="settings-section settings-model-section">
                    <div className="settings-section-head">
                      <h3>{t('settings.modelList')}</h3>
                      {(() => {
                        const providerId =
                          editingId ??
                          (form.name.trim() ? slugProviderId(form.name.trim(), form.baseURL) : null)
                        const cnt = providerId
                          ? (customProviders.find((c) => c.id === providerId)?.models.length ?? 0)
                          : 0
                        return <span className="settings-section-count">{cnt}</span>
                      })()}
                    </div>
                    <div className="settings-model-list">
                      {(() => {
                        const providerId =
                          editingId ??
                          (form.name.trim() ? slugProviderId(form.name.trim(), form.baseURL) : null)
                        const models = providerId
                          ? (customProviders.find((c) => c.id === providerId)?.models ?? [])
                          : []
                        if (models.length === 0 && !showAddModel) {
                          return (
                            <p className="settings-muted settings-model-empty">
                              {t('settings.customEmpty')}
                            </p>
                          )
                        }
                        return models.map((m) => {
                          const active = leaderModel === m.id
                          const isEditing = editingModelId === m.id
                          const ctx = formatCtx((m as { contextWindow?: number }).contextWindow)
                          const thinks =
                            (m as { thinkingIntensities?: ThinkingIntensity[] })
                              .thinkingIntensities ?? []
                          return (
                            <div
                              key={m.id}
                              className={`model-card${active ? ' active' : ''}${isEditing ? ' editing' : ''}`}
                            >
                              <div
                                className="model-card-head"
                                onClick={() => {
                                  pickModel(m.id)
                                  if (isEditing) cancelEditModel()
                                  else beginEditModel(m)
                                }}
                              >
                                <span className="m-mid">
                                  <span className="m-name">
                                    {m.id.includes('/')
                                      ? m.id.split('/').slice(1).join('/')
                                      : m.label}
                                  </span>
                                  <span className="m-id">{m.id}</span>
                                </span>
                                <span className="meta">
                                  {ctx && <span className="ctx">{ctx}</span>}
                                  {thinks.length > 0 && (
                                    <span className="think-tags">
                                      {thinks.slice(0, 4).map((lv) => (
                                        <span key={lv} className={lv === 'off' ? 'off' : ''}>
                                          {lv}
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                </span>
                                {isEditing ? (
                                  <div
                                    className="edit-actions"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      className="btn-ghost btn-sm"
                                      disabled={saving}
                                      onClick={cancelEditModel}
                                    >
                                      {t('settings.cancelEdit')}
                                    </button>
                                    <button
                                      type="button"
                                      className="settings-save-btn btn-sm"
                                      disabled={saving}
                                      onClick={() => void updateModelInActiveProvider()}
                                    >
                                      {saving ? t('app.loading') : t('settings.save')}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="remove-btn"
                                    title={t('settings.removeModel')}
                                    aria-label={t('settings.removeModel')}
                                    disabled={saving || models.length <= 1}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void removeModelFromActiveProvider(m.id)
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                              <Expandable open={isEditing} contentClassName="model-card-body">
                                <div>
                                  <div className="field-label">{t('settings.ctxWindow')}</div>
                                  <input
                                    className="settings-input mono"
                                    value={editModelForm.contextWindow}
                                    onChange={(e) =>
                                      setEditModelForm((f) => ({
                                        ...f,
                                        contextWindow: e.target.value,
                                      }))
                                    }
                                    placeholder={t('settings.ctxWindowPh')}
                                  />
                                </div>
                                <div>
                                  <div className="field-label">
                                    {t('settings.perModelThinking')}
                                  </div>
                                  <div className="think-support-grid" role="group">
                                    {THINKING_INTENSITY_OPTIONS.map((level) => {
                                      const checked =
                                        editModelForm.thinkingIntensities.includes(level)
                                      return (
                                        <button
                                          key={level}
                                          type="button"
                                          className={`think-support-chip${checked ? ' on' : ''}`}
                                          aria-pressed={checked}
                                          onClick={() => {
                                            setEditModelForm((f) => {
                                              const set = new Set(f.thinkingIntensities)
                                              if (set.has(level)) set.delete(level)
                                              else set.add(level)
                                              const next = THINKING_INTENSITY_OPTIONS.filter((l) =>
                                                set.has(l),
                                              )
                                              return {
                                                ...f,
                                                thinkingIntensities:
                                                  next.length > 0
                                                    ? next
                                                    : (['off'] as ThinkingIntensity[]),
                                              }
                                            })
                                          }}
                                        >
                                          {level}
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              </Expandable>
                            </div>
                          )
                        })
                      })()}

                      {/* 行内添加模型：高度展开动画 */}
                      <Expandable open={showAddModel} contentClassName="add-model-inline">
                        <div className="inline-title">
                          <span className="dot" aria-hidden />
                          {t('settings.addModelInline')}
                        </div>
                        <div className="settings-field">
                          <label>{t('settings.modelId')}</label>
                          <input
                            className="settings-input mono"
                            value={addModelForm.id}
                            onChange={(e) => setAddModelForm((f) => ({ ...f, id: e.target.value }))}
                            placeholder={t('settings.customModelPh')}
                          />
                          <span className="settings-field-hint">
                            {t('settings.customModelHint')}
                          </span>
                        </div>
                        <div className="add-model-inline-body">
                          <div className="settings-field">
                            <label>{t('settings.ctxWindow')}</label>
                            <input
                              className="settings-input mono"
                              value={addModelForm.contextWindow}
                              onChange={(e) =>
                                setAddModelForm((f) => ({
                                  ...f,
                                  contextWindow: e.target.value,
                                }))
                              }
                              placeholder={t('settings.ctxWindowPh')}
                            />
                            <span className="settings-field-hint">
                              {t('settings.ctxWindowHint')}
                            </span>
                          </div>
                          <div className="settings-field">
                            <label>{t('settings.perModelThinking')}</label>
                            <div className="think-support-grid" role="group">
                              {THINKING_INTENSITY_OPTIONS.map((level) => {
                                const checked = addModelForm.thinkingIntensities.includes(level)
                                return (
                                  <button
                                    key={level}
                                    type="button"
                                    className={`think-support-chip${checked ? ' on' : ''}`}
                                    aria-pressed={checked}
                                    onClick={() => {
                                      setAddModelForm((f) => {
                                        const set = new Set(f.thinkingIntensities)
                                        if (set.has(level)) set.delete(level)
                                        else set.add(level)
                                        const next = THINKING_INTENSITY_OPTIONS.filter((l) =>
                                          set.has(l),
                                        )
                                        return {
                                          ...f,
                                          thinkingIntensities:
                                            next.length > 0
                                              ? next
                                              : (['off'] as ThinkingIntensity[]),
                                        }
                                      })
                                    }}
                                  >
                                    <span className="box" aria-hidden />
                                    {level}
                                  </button>
                                )
                              })}
                            </div>
                            <span className="settings-field-hint">
                              {t('settings.perModelThinkingHint')}
                            </span>
                          </div>
                        </div>
                        <div className="add-model-inline-actions">
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => {
                              setAddModelForm(emptyAddModelForm())
                              setShowAddModel(false)
                            }}
                          >
                            {t('settings.cancelEdit')}
                          </button>
                          <button
                            type="button"
                            className="settings-save-btn"
                            disabled={saving}
                            onClick={() => void addModelToActiveProvider()}
                          >
                            {saving ? t('app.loading') : t('settings.addModelBtn')}
                          </button>
                        </div>
                      </Expandable>
                      {!showAddModel && (
                        <button
                          type="button"
                          className="add-model-toggle"
                          onClick={() => {
                            setAddModelForm(emptyAddModelForm())
                            setShowAddModel(true)
                          }}
                        >
                          <span className="plus" aria-hidden>
                            +
                          </span>
                          {t('settings.addModel')}
                        </button>
                      )}
                    </div>
                    {focusProviderId === '__new__' && (
                      <span className="settings-field-hint">{t('settings.firstModelHint')}</span>
                    )}
                  </section>
                  {focusProviderId === '__new__' && (
                    <div className="model-edit-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          resetForm()
                          setFocusProviderId(null)
                        }}
                      >
                        {t('settings.cancelEdit')}
                      </button>
                      <button type="button" className="settings-save-btn" onClick={saveCustomForm}>
                        {t('settings.addToList')}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="settings-provider-head">
                    <div className="pname">
                      {selectedProvider && (
                        <span
                          className="logo"
                          style={{
                            background: `${getProviderIconMeta(selectedProvider.id).color}22`,
                          }}
                          aria-hidden
                        >
                          <ProviderLogo providerId={selectedProvider.id} size={14} />
                        </span>
                      )}
                      {selectedProvider?.name ?? '—'}
                    </div>
                    {/* 内置：以是否配置 Key 为态；滑块带文案，不可关停业务（仅展示） */}
                    <button
                      type="button"
                      className={`enable-switch${selectedProvider?.configured ? ' is-on' : ''}`}
                      role="switch"
                      aria-checked={Boolean(selectedProvider?.configured)}
                      title={
                        selectedProvider?.configured
                          ? t('settings.configured')
                          : t('settings.needKey')
                      }
                      aria-label={t('settings.enableProvider')}
                      disabled
                    >
                      <span className="enable-switch-knob" aria-hidden />
                    </button>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="settings-save-btn"
                      disabled={saving || loading || !leaderModel.trim()}
                      onClick={() => void onSave()}
                    >
                      {saving ? t('app.loading') : t('settings.save')}
                    </button>
                  </div>

                  <div className="settings-field">
                    <label htmlFor="settings-builtin-base-url">{t('settings.customBaseUrl')}</label>
                    <input
                      id="settings-builtin-base-url"
                      className="settings-input mono"
                      value={selectedProvider?.baseURL ?? ''}
                      disabled
                      aria-label={t('settings.customBaseUrl')}
                    />
                  </div>

                  <div className="settings-field">
                    <label htmlFor="settings-builtin-api-key">{t('settings.customApiKey')}</label>
                    <input
                      id="settings-builtin-api-key"
                      type="password"
                      className="settings-input"
                      autoComplete="off"
                      placeholder={
                        selectedProvider?.configured ? '***********' : t('settings.enterKey')
                      }
                      value={keyDraft}
                      onChange={(e) =>
                        selectedProvider &&
                        setDraftKeys((d) => ({
                          ...d,
                          [selectedProvider.apiKeyEnv]: e.target.value,
                        }))
                      }
                      aria-label={t('settings.customApiKey')}
                    />
                    <span className="settings-field-hint">
                      {needsKey
                        ? t('settings.keyRequired')
                        : selectedProvider?.configured
                          ? t('settings.keyReplaceHint')
                          : t('settings.keyOptionalUpdate')}
                    </span>
                  </div>

                  <section className="settings-section">
                    <div className="settings-section-head">
                      <h3>{t('settings.pickModel')}</h3>
                      <span className="settings-section-count">
                        {(selectedProvider?.models ?? []).length}
                      </span>
                    </div>
                    <div
                      className="settings-model-list"
                      role="listbox"
                      aria-label={t('settings.pickModel')}
                    >
                      {(selectedProvider?.models ?? []).map((m) => {
                        const active = leaderModel === m.id
                        const ctx = formatCtx((m as { contextWindow?: number }).contextWindow)
                        const thinks =
                          (m as { thinkingIntensities?: ThinkingIntensity[] })
                            .thinkingIntensities ?? selectedProvider?.thinkingIntensities
                        return (
                          <div key={m.id} className={`model-card${active ? ' active' : ''}`}>
                            <div className="model-card-head" onClick={() => pickModel(m.id)}>
                              <span className="m-mid">
                                <span className="m-name">
                                  {m.id.includes('/')
                                    ? m.id.split('/').slice(1).join('/')
                                    : m.label}
                                </span>
                                <span className="m-id">{m.id}</span>
                              </span>
                              <span className="meta">
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
                          </div>
                        )
                      })}
                      {(selectedProvider?.models ?? []).length === 0 && (
                        <p className="settings-muted">{t('settings.customEmpty')}</p>
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && tab === 'workers' && (
        <div className="settings-workers">
          <h2 className="settings-page-title">{t('settings.navWorkers')}</h2>
          <p className="settings-page-desc">{t('settings.descWorkers')}</p>

          <div className="worker-settings-stack">
            <div className="settings-form-card worker-list-card">
              <div className="worker-list-head">
                <div className="model-list-label">{t('workers.registered')}</div>
                <div className="worker-list-actions">
                  <button
                    type="button"
                    className="settings-btn-soft"
                    onClick={() => setRegOpen((v) => !v)}
                  >
                    {t('workers.register')}
                  </button>
                  {onHealthAllWorkers && (
                    <button
                      type="button"
                      className="settings-btn-soft"
                      onClick={() => void onHealthAllWorkers()}
                    >
                      {t('workers.healthAll')}
                    </button>
                  )}
                </div>
              </div>
              <p className="settings-field-hint" style={{ margin: '0 0 4px' }}>
                {t('workers.manualRegistrationHint')}
              </p>

              {workers.length === 0 && <p className="settings-muted">{t('workers.empty')}</p>}
              {workers.map((w) => (
                <div key={w.id} className="w-row worker-list-row worker-settings-row">
                  <span
                    className={`worker-logo ${workerLogoClass(w.kind)}`}
                    title={w.name}
                    aria-hidden
                  >
                    <WorkerBrandLogo kind={w.kind} size={14} />
                  </span>
                  <div className="info">
                    <div className="n">
                      {w.name}
                      {w.health === 'healthy' && (
                        <span className="tag-on" style={{ marginLeft: 6 }}>
                          {t('workers.health.healthy')}
                        </span>
                      )}
                      {w.readiness && (
                        <span style={{ marginLeft: 6, verticalAlign: 'middle' }}>
                          <WorkerReadinessBadge
                            status={w.readiness.status}
                            code={w.readiness.code}
                            nextAction={w.readiness.nextAction}
                            locale={locale === 'zh' ? 'zh' : 'en'}
                          />
                        </span>
                      )}
                    </div>
                    <div className="s mono">
                      {w.source?.type === 'registry'
                        ? `${w.source.registryId}@${w.source.registryVersion} · ${w.source.distribution}`
                        : `${w.command} ${(w.args ?? []).join(' ')}`}
                    </div>
                  </div>
                  {w.readiness?.status === 'auth_required' &&
                    (() => {
                      const terminalMethod = w.capabilitySummary?.authMethods?.find(
                        (candidate) => candidate.type === 'terminal',
                      )
                      const agentMethod = w.capabilitySummary?.authMethods?.find(
                        (candidate) => candidate.type === 'agent',
                      )
                      const envMethod = w.capabilitySummary?.authMethods?.find(
                        (candidate) => candidate.type === 'env_var',
                      )
                      const active =
                        agentAuthOperation?.workerId === w.id ? agentAuthOperation.snapshot : null
                      return (
                        <div className="worker-settings-auth-actions">
                          {terminalMethod && (
                            <button
                              type="button"
                              className="settings-btn-soft worker-settings-auth-btn"
                              onClick={() =>
                                setTerminalAuth({
                                  workerId: w.id,
                                  workerName: w.name,
                                  methodId: terminalMethod.id,
                                })
                              }
                            >
                              {t('workers.terminalOpen')}
                            </button>
                          )}
                          {agentMethod && !active && (
                            <button
                              type="button"
                              className="settings-btn-soft worker-settings-auth-btn"
                              disabled={Boolean(agentAuthOperation)}
                              onClick={() => void startAgentAuthentication(w.id, agentMethod.id)}
                            >
                              {t('workers.authAgent')}
                            </button>
                          )}
                          {active && (
                            <>
                              <span className="settings-field-hint">
                                {active.status === 'queued'
                                  ? t('workers.authQueued')
                                  : t('workers.authRunning')}
                              </span>
                              <button
                                type="button"
                                className="settings-btn-soft"
                                onClick={() => void cancelAgentAuthentication()}
                              >
                                {t('workers.authCancel')}
                              </button>
                            </>
                          )}
                          {Boolean(envMethod?.envVarNames?.length) && (
                            <button
                              type="button"
                              className="settings-btn-soft worker-settings-auth-btn"
                              disabled={secretBusy}
                              onClick={() =>
                                setSecretEditor({
                                  workerId: w.id,
                                  workerName: w.name,
                                  envVarNames: [...envMethod!.envVarNames!],
                                })
                              }
                            >
                              {t('workers.authConfigureSecrets')}
                            </button>
                          )}
                        </div>
                      )
                    })()}
                  <button
                    type="button"
                    className={`switch toggle${w.enabled ? ' on' : ''}`}
                    role="switch"
                    aria-checked={w.enabled}
                    aria-label={t('workers.formEnabled')}
                    onClick={() => onToggleWorker?.(w.id, !w.enabled)}
                  />
                </div>
              ))}
              {secretEditor && (
                <form
                  className="worker-secret-editor"
                  onSubmit={(event) => void saveWorkerSecrets(event)}
                >
                  <div>
                    <strong>{secretEditor.workerName}</strong>
                    <p className="settings-field-hint">{t('workers.authSecretHint')}</p>
                  </div>
                  {secretEditor.envVarNames.map((envName) => (
                    <label key={envName} className="settings-field">
                      <span className="mono">{envName}</span>
                      <input
                        className="settings-input mono"
                        type="password"
                        name={envName}
                        autoComplete="off"
                        required
                      />
                    </label>
                  ))}
                  <div className="model-edit-actions">
                    <button type="button" className="btn-ghost" onClick={closeSecretEditor}>
                      {t('workers.cancel')}
                    </button>
                    <button type="submit" className="settings-save-btn" disabled={secretBusy}>
                      {secretBusy ? t('app.loading') : t('workers.authSaveSecrets')}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {regOpen && (
              <div className="settings-form-card worker-register-card">
                <div className="worker-list-head">
                  <div className="model-list-label">{t('workers.registerTitle')}</div>
                </div>
                <div className="settings-field">
                  <label>{t('workers.registryAgent')}</label>
                  <WorkerRegistryCombobox
                    options={workerRegistry}
                    selectedId={regSelectedId}
                    loading={workerRegistryLoading}
                    error={workerRegistryError}
                    placeholder={t('workers.registrySearch')}
                    loadingLabel={t('workers.registryLoading')}
                    emptyLabel={t('workers.registryEmpty')}
                    localInstallLabel={t('workers.registryLocalInstall')}
                    onSelect={(option) => {
                      if (!option) {
                        setRegSelectedId(null)
                        setRegManifestDigest('')
                        setRegVersion('')
                        return
                      }
                      const draft = createWorkerDraftFromRegistry(option)
                      setRegSelectedId(draft.selectedId)
                      setRegName(draft.name)
                      setRegCommand(draft.command)
                      setRegArgs(draft.args)
                      setRegEnv(draft.env)
                      setRegDescription(draft.description)
                      setRegVersion(option.version)
                      setRegManifestDigest(option.manifestDigest ?? '')
                      setRegDistribution(option.distribution)
                      setRegTrustNoSha(false)
                    }}
                  />
                  <span className="settings-field-hint">{t('workers.registryHint')}</span>
                </div>
                {selectedRegistryOption && (
                  <div className="settings-field registry-prepare-panel">
                    <RegistryAgentDetail
                      option={selectedRegistryOption}
                      distribution={regDistribution}
                      trustNoSha={regTrustNoSha}
                      onDistributionChange={(distribution) => {
                        setRegDistribution(distribution)
                        setRegTrustNoSha(false)
                      }}
                      onTrustNoShaChange={setRegTrustNoSha}
                    />
                    {selectedRegistryOption && !regManifestDigest && (
                      <p className="settings-error" role="alert">
                        {t('workers.registryManifestUnavailable')}
                      </p>
                    )}
                    {regPrepareStatus && (
                      <p className="settings-muted" style={{ marginTop: 8 }}>
                        {regPrepareStatus}
                      </p>
                    )}
                    {pendingRegistryPrepare && (
                      <WorkerPrepareProgress
                        initial={pendingRegistryPrepare.operation}
                        onSucceeded={(result) => {
                          void finishRegistryRegistration(result)
                        }}
                        onFailed={(operation) => {
                          setRegBusy(false)
                          if (operation.status === 'failed') {
                            toastError(
                              operation.code
                                ? `${operation.code}: ${operation.error ?? ''}`.trim()
                                : (operation.error ?? t('workers.registryPrepareFailed')),
                            )
                          }
                        }}
                        onCancel={() => setRegBusy(false)}
                        onRetry={() => {
                          setPendingRegistryPrepare(null)
                          void saveWorker()
                        }}
                      />
                    )}
                  </div>
                )}
                {isRegistryPath && !selectedRegistryOption && (
                  <p className="settings-error" role="alert">
                    {t('workers.registrySelectionUnavailable')}
                  </p>
                )}
                <div className="settings-field">
                  <label>{t('workers.formName')}</label>
                  <input
                    className="settings-input"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                  />
                </div>
                {/* Registry path: command is Owner-materialized; keep custom fields for manual only */}
                {!isRegistryPath && (
                  <>
                    <div className="settings-field">
                      <label>{t('workers.customLaunchKind')}</label>
                      <select
                        className="field-select"
                        value={regCustomLaunchKind}
                        onChange={(event) =>
                          setRegCustomLaunchKind(event.target.value as CustomAcpLaunchKind)
                        }
                      >
                        <option value="npx">npx package</option>
                        <option value="uvx">uvx package</option>
                        <option value="system">{t('workers.customSystemExecutable')}</option>
                        <option value="local">{t('workers.customLocalExecutable')}</option>
                      </select>
                    </div>
                    <div className="settings-field">
                      <label>
                        {regCustomLaunchKind === 'npx' || regCustomLaunchKind === 'uvx'
                          ? t('workers.customPackageSpec')
                          : t('workers.formCommand')}
                      </label>
                      <input
                        className="settings-input mono"
                        value={regCommand}
                        onChange={(e) => setRegCommand(e.target.value)}
                        placeholder={
                          regCustomLaunchKind === 'local'
                            ? '/absolute/path/to/acp-agent'
                            : regCustomLaunchKind === 'system'
                              ? 'acp-agent'
                              : '@scope/acp-agent@version'
                        }
                      />
                    </div>
                    <div className="settings-field">
                      <label>{t('workers.formArgs')}</label>
                      <input
                        className="settings-input mono"
                        value={regArgs}
                        onChange={(e) => setRegArgs(e.target.value)}
                      />
                    </div>
                  </>
                )}
                {isRegistryPath && (
                  <p className="settings-field-hint">{t('workers.registryOwnerManagedHint')}</p>
                )}
                <div className="settings-row card-row">
                  <div className="lbl-block">
                    <div className="lbl">{t('workers.formEnabled')}</div>
                  </div>
                  <button
                    type="button"
                    className={`switch${regEnabled ? ' on' : ''}`}
                    role="switch"
                    aria-checked={regEnabled}
                    onClick={() => setRegEnabled((v) => !v)}
                  />
                </div>
                <div className="model-edit-actions">
                  <button type="button" className="btn-ghost" onClick={() => setRegOpen(false)}>
                    {t('workers.cancel')}
                  </button>
                  <button
                    type="button"
                    className="settings-save-btn"
                    disabled={
                      regBusy ||
                      !regName.trim() ||
                      (registrationRoute.kind === 'custom'
                        ? !regCommand.trim()
                        : registrationRoute.kind === 'registry_unavailable')
                    }
                    onClick={() => void saveWorker()}
                  >
                    {t('workers.formSave')}
                  </button>
                </div>
              </div>
            )}
            {terminalAuth && (
              <WorkerAuthTerminalModal
                workerId={terminalAuth.workerId}
                workerName={terminalAuth.workerName}
                methodId={terminalAuth.methodId}
                onClose={() => setTerminalAuth(null)}
                onComplete={() => {
                  setTerminalAuth(null)
                  onRefreshSnapshot?.()
                  toastSuccess(t('workers.terminalSucceeded'))
                }}
              />
            )}
          </div>
        </div>
      )}

      {data && !loading && tab === 'about' && (
        <div className="settings-about">
          <h2 className="settings-page-title">{t('settings.navAbout')}</h2>
          <p className="settings-page-desc">{t('settings.descAbout')}</p>
          <div className="settings-form-card about-card">
            <BrandLogo className="about-logo" size={56} title={t('app.title')} />
            <div className="app-name">{t('app.title')}</div>
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
                <div>
                  {t('settings.storageData')}: {data.storagePaths.data}
                </div>
                <div>
                  {t('settings.storageCache')}: {data.storagePaths.cache}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  const navIcon = (id: TabId) => {
    if (id === 'general') return <IconSettings size={16} />
    if (id === 'model') return <IconCpu size={16} />
    if (id === 'workers') return <IconWorkers size={16} />
    return <IconInfo size={16} />
  }

  // 线稿 settings-shell：左侧 settings-nav（返回+四项），右侧 settings-main；无顶部大标题栏
  return (
    <div className="settings-shell">
      <aside className="settings-nav" aria-label={t('settings.title')}>
        {/* 系统 traffic lights 占位 + 拖拽区 */}
        <div className="sidebar-top" aria-hidden />
        <button type="button" className="settings-back" onClick={onClose}>
          <IconChevronLeft size={14} />
          {t('settings.back')}
        </button>
        <nav className="settings-nav-list">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${tab === item.id ? ' on' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <span className="glyph" aria-hidden>
                {navIcon(item.id)}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="settings-main">
        {/* Absolute titleband — does not push page title/desc down */}
        <div className="window-drag-top window-drag-top--overlay" aria-hidden />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            className="settings-tab-pane"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={tabMotion}
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
