import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type {
  CustomAcpLaunchKind,
  CustomAcpRegistrationInput,
  CustomAcpPreview,
  PromptSettings,
  TeamTemplate,
  WorkerTimeoutSettings,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { normalizePromptSettings } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import {
  fetchSettings,
  performDangerZoneAction,
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
import type { DangerZoneAction } from '../lib/api'
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
import { ProviderLogo } from '../lib/provider-icons'
import { useTheme } from '../theme/ThemeProvider'
import { sortThemesForDisplay } from '../theme/theme.config'
import { useSendShortcut } from '../hooks/useSendShortcut'
import type { SendShortcut } from '../lib/send-shortcut'
import { useMotionPreference } from '../motion/MotionPreferenceProvider'
import type { MotionPreference } from '../lib/motion-preference'
import { BrandLogo } from './BrandLogo'
import { OpenSourceCredits } from './OpenSourceCredits'
import { SettingsSelect } from './SettingsSelect'
import { Expandable } from './ui/Expandable'

const SETTINGS_TAB_EASE = [0.4, 0, 0.2, 1] as const

import {
  IconChevronLeft,
  IconCpu,
  IconCrew,
  IconInfo,
  IconFileEdit,
  IconSettings,
  IconTrash,
  IconWorkers,
  resolveWorkerIconAgentId,
  WorkerBrandLogo,
} from './Icons'
import { TeamTemplateLibrary } from './TeamTemplateLibrary'
import type { Locale } from '../i18n/locales'
import { formatContextWindow, parseContextWindow } from '../lib/context-window'
import { useToast } from './Toast'
import { WorkerRegistryCombobox } from './WorkerRegistryCombobox'
import { WorkerDefaultRoleTypeEditor } from './WorkerDefaultRoleTypeEditor'
import { WorkerCommandField } from './WorkerCommandField'
import { WorkerProbeConsole } from './WorkerProbeConsole'
import { PromptSettingsEditor } from './PromptSettingsEditor'
import { WorkerTimeoutSettingsEditor } from './WorkerTimeoutSettingsEditor'
import { WorkerExecutionConfigEditor } from './WorkerExecutionConfigEditor'
import { WorkerIconPicker } from './WorkerIconPicker'
import {
  createWorkerDraftFromRegistry,
  resolveWorkerRegistrationRoute,
} from '../lib/worker-registry'
import {
  matchNpmRegistryPreset,
  NPM_REGISTRY_PRESETS,
  type NpmRegistryPresetId,
} from '../lib/npm-registry-url'
import { WorkerReadinessBadge } from './WorkerReadinessBadge'
import { WorkerPrepareProgress, pollRegistryOperationUntilTerminal } from './WorkerPrepareProgress'
import { RegistryAgentDetail } from './RegistryAgentDetail'
import { WorkerAuthTerminalModal } from './WorkerAuthTerminalModal'
import { ConfirmAddCliDialog } from './ConfirmAddCliDialog'
import { ConfirmDialog, type ConfirmDialogConfig } from './ui/ConfirmDialog'
import { useAcpRegistryCatalog } from '../hooks/useAcpRegistryCatalog'
import { resetRendererPreferences } from '../lib/reset-renderer-preferences'
import {
  DANGER_ACTION_IMPACT_IDS,
  DANGER_IMPACT_STAT_KEYS,
  resolveDangerZoneToggleIntent,
  shouldCollapseDangerZoneForTab,
  type DangerImpactId,
  type DangerZoneStats,
} from './settings-danger-zone'

type TabId = 'general' | 'model' | 'prompts' | 'workers' | 'about'

interface Props {
  onClose: () => void
  /** Open a specific settings tab (e.g. deep-link from WORKER_AUTH_REQUIRED CTA). */
  initialTab?: TabId
  workers: WorkerRegistration[]
  projectId?: string | null
  onToggleWorker: (id: string, enabled: boolean) => void
  onSetWorkerDefaultRoleType: (id: string, roleType: WorkerRole) => Promise<unknown>
  onHealthAllWorkers: () => void | Promise<unknown>
  onRegisterCustomAcpWorker: (body: CustomAcpRegistrationInput) => Promise<unknown>
  onRefreshSnapshot: () => void
  dangerStats?: DangerZoneStats
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
  projectId,
  onToggleWorker,
  onSetWorkerDefaultRoleType,
  onHealthAllWorkers,
  onRegisterCustomAcpWorker,
  onRefreshSnapshot,
  dangerStats = {
    projects: 0,
    workers: workers.length,
    workerSessions: 0,
    crews: 0,
    chatSessions: 0,
  },
}: Props) {
  const { t, locale, setLocale } = useI18n()
  const {
    mode: themeMode,
    setMode: setThemeMode,
    lightThemeId,
    darkThemeId,
    lightThemes,
    darkThemes,
    setLightThemeId,
    setDarkThemeId,
    reloadThemes,
    themesDirectory,
    themesLoading,
  } = useTheme()
  const { sendShortcut, setSendShortcut } = useSendShortcut()
  const {
    preference: motionPreference,
    setPreference: setMotionPreference,
    reduceMotion,
  } = useMotionPreference()
  const tabMotion = {
    duration: reduceMotion ? 0 : 0.16,
    ease: SETTINGS_TAB_EASE,
  }
  const { success: toastSuccess, error: toastError } = useToast()
  const [reloadThemesUiBusy, setReloadThemesUiBusy] = useState(false)
  const displayLightThemes = useMemo(() => sortThemesForDisplay(lightThemes), [lightThemes])
  const displayDarkThemes = useMemo(() => sortThemesForDisplay(darkThemes), [darkThemes])

  const reloadColorThemes = useCallback(async () => {
    setReloadThemesUiBusy(true)
    const startedAt = Date.now()
    try {
      const result = await reloadThemes()
      const remaining = Math.max(0, 500 - (Date.now() - startedAt))
      if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
      if (!result.ok) {
        toastError(t('settings.reloadThemesFailed'))
        return
      }
      toastSuccess(t('settings.reloadThemesSuccess', { count: result.loaded }))
    } finally {
      setReloadThemesUiBusy(false)
    }
  }, [reloadThemes, t, toastError, toastSuccess])
  const [tab, setTab] = useState<TabId>(initialTab ?? 'general')
  // Sync external tab changes (e.g. "管理模型" entry pinning 'model') even
  // when the panel is already open — useState initial value only fires on mount.
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])
  const [regOpen, setRegOpen] = useState(false)
  /** Strong exclusive path: auto = ACP Registry; manual = custom launch. */
  const [regMode, setRegMode] = useState<'auto' | 'manual'>('auto')
  const [regName, setRegName] = useState('')
  const [regCommand, setRegCommand] = useState('')
  const [regArgs, setRegArgs] = useState('')
  const [regCustomLaunchKind, setRegCustomLaunchKind] = useState<CustomAcpLaunchKind>('auto')
  const [regEnv, setRegEnv] = useState<Record<string, string>>({})
  const [regDescription, setRegDescription] = useState('')
  /** Manual registration icon: undefined = auto-match; '' = none; id = explicit. */
  const [regIconAgentId, setRegIconAgentId] = useState<string | undefined>(undefined)
  const [regIconUserPicked, setRegIconUserPicked] = useState(false)
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
  const [regBusy, setRegBusy] = useState(false)
  const [terminalAuth, setTerminalAuth] = useState<{
    workerId: string
    workerName: string
    methodId: string
  } | null>(null)
  // Custom-CLI preview: probe result + duplicate detection, shown in the confirm dialog before
  // the worker is actually persisted. Holds the pending input so confirm can re-send it.
  const [customPreview, setCustomPreview] = useState<{
    preview: CustomAcpPreview
    input: CustomAcpRegistrationInput
  } | null>(null)
  // Generic confirmation dialog state (delete/destroy actions), replacing native OS confirms.
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmDialogConfig | null>(null)
  /** True while a provider delete is in flight (header + confirm button). */
  const [deletingProvider, setDeletingProvider] = useState(false)
  /**
   * In-flight enable-toggle guard (ref, not state):
   * state + disabled opacity would dim the switch and re-render the panel mid-toggle.
   */
  const togglingProviderIdRef = useRef<string | null>(null)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [dangerBusy, setDangerBusy] = useState<DangerZoneAction | null>(null)
  useEffect(() => {
    if (shouldCollapseDangerZoneForTab(tab)) setDangerOpen(false)
  }, [tab])
  // Rail focus drives the workers-tab right panel: which agent/crew is selected, or special views.
  const [railFocus, setRailFocus] = useState<
    { type: 'agent'; id: string } | { type: 'crew'; id: string } | { type: 'register' } | null
  >(null)
  // Team templates loaded for the Crews rail section + crew detail panel.
  const [teamTemplates, setTeamTemplates] = useState<TeamTemplate[]>([])
  const [teamTemplatesLoading, setTeamTemplatesLoading] = useState(false)
  useEffect(() => {
    if (tab !== 'workers') return
    let cancelled = false
    setTeamTemplatesLoading(true)
    api
      .listTeamTemplates()
      .then(({ templates }) => {
        if (!cancelled) setTeamTemplates(templates)
      })
      .catch(() => {
        /* keep empty list on error */
      })
      .finally(() => {
        if (!cancelled) setTeamTemplatesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])
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
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({})
  const secretControllerRef = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [promptSaving, setPromptSaving] = useState(false)
  const [workerTimeoutSaving, setWorkerTimeoutSaving] = useState(false)
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [leaderModel, setLeaderModel] = useState('')
  const [promptSettings, setPromptSettings] = useState<PromptSettings>(() =>
    normalizePromptSettings(undefined),
  )
  const [workerTimeouts, setWorkerTimeouts] = useState<WorkerTimeoutSettings>({
    jobTimeoutMs: 600_000,
    queueTimeoutMs: 600_000,
  })
  const [npmRegistryDraft, setNpmRegistryDraft] = useState('')
  const [npmRegistrySaving, setNpmRegistrySaving] = useState(false)
  const [npmRegistryError, setNpmRegistryError] = useState<string | null>(null)
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
  /** Add-provider wizard: models.dev catalog vs hand-built custom */
  const [addProviderMode, setAddProviderMode] = useState<'models-dev' | 'custom'>('models-dev')
  const [modelsDevQuery, setModelsDevQuery] = useState('')
  const [modelsDevList, setModelsDevList] = useState<
    Array<{
      id: string
      name: string
      modelCount: number
      npm?: string
      api?: string
      needsBaseURL: boolean
    }>
  >([])
  const [modelsDevMeta, setModelsDevMeta] = useState<{
    fetchedAt: string
    providerCount: number
  } | null>(null)
  const [modelsDevLoading, setModelsDevLoading] = useState(false)
  const [modelsDevError, setModelsDevError] = useState<string | null>(null)
  const [modelsDevImportingId, setModelsDevImportingId] = useState<string | null>(null)
  const [leaderMaxSteps, setLeaderMaxSteps] = useState<number | null>(null)
  const [leaderMaxStepsDraft, setLeaderMaxStepsDraft] = useState<string>('')
  const [leaderMaxStepsError, setLeaderMaxStepsError] = useState<string | null>(null)
  const [selectionStatus, setSelectionStatus] = useState<
    'featured' | 'not_featured' | 'registry_unknown' | null
  >(null)
  const {
    catalog: workerRegistryCatalog,
    options: workerRegistry,
    loading: workerRegistryLoading,
    checking: workerRegistryChecking,
    error: workerRegistryError,
    checkForUpdates: checkWorkerRegistryUpdates,
  } = useAcpRegistryCatalog({
    enabled: regOpen,
    fetchCatalog: (signal) => api.getWorkerRegistry(signal),
    checkCatalog: (signal) => api.checkWorkerRegistryUpdate(signal),
  })
  const workerRegistryAgentCount =
    workerRegistryCatalog?.agentCount ??
    workerRegistryCatalog?.agentsV2?.length ??
    workerRegistryCatalog?.agents.length ??
    0
  const workerRegistrySource =
    workerRegistryCatalog?.source === 'persisted'
      ? t('workers.registrySourcePersisted')
      : t('workers.registrySourceBundled')
  const workerRegistryFetchedAt = useMemo(() => {
    const raw = workerRegistryCatalog?.fetchedAt
    if (!raw) return t('workers.registryBundledAtRelease')
    const date = new Date(raw)
    if (!Number.isFinite(date.getTime())) return t('workers.registryBundledAtRelease')
    return new Intl.DateTimeFormat(
      locale === 'zh' ? 'zh-CN' : locale === 'zh-TW' ? 'zh-TW' : 'en-US',
      {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    ).format(date)
  }, [locale, t, workerRegistryCatalog?.fetchedAt])

  const checkRegistryUpdates = async () => {
    const result = await checkWorkerRegistryUpdates()
    if (!result) {
      toastError(t('workers.registryUpdateFailed'))
      return
    }
    switch (result.updateStatus) {
      case 'updated':
        toastSuccess(t('workers.registryUpdated'))
        break
      case 'up_to_date':
        toastSuccess(t('workers.registryUpToDate'))
        break
      case 'update_required':
        toastError(t('workers.registryUpdateRequired'))
        break
      default:
        toastError(result.message || t('workers.registryUpdateFailed'))
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await fetchSettings()
      setData(s)
      setLeaderModel(s.settings.leaderModel)
      setPromptSettings(normalizePromptSettings(s.settings.prompts))
      setWorkerTimeouts(s.settings.workerTimeouts)
      setNpmRegistryDraft(s.settings.npmRegistry ?? '')
      setNpmRegistryError(null)
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

  const loadModelsDevList = useCallback(
    async (opts?: { forceRefresh?: boolean; q?: string }) => {
      setModelsDevLoading(true)
      setModelsDevError(null)
      const q = opts?.q ?? modelsDevQuery
      try {
        if (opts?.forceRefresh) {
          try {
            await api.refreshModelsDevCatalog()
          } catch (e) {
            // Keep serving local LKG if refresh fails (e.g. models.dev unreachable)
            const msg = e instanceof Error ? e.message : String(e)
            const existing = await api.listModelsDevProviders(q).catch(() => null)
            if (existing?.catalogAvailable) {
              setModelsDevList(existing.providers)
              setModelsDevMeta(
                existing.meta
                  ? {
                      fetchedAt: existing.meta.fetchedAt,
                      providerCount: existing.meta.providerCount,
                    }
                  : null,
              )
              setModelsDevError(t('settings.modelsDevRefreshFailedKeepLkg', { error: msg }))
              return
            }
            setModelsDevList([])
            setModelsDevMeta(null)
            setModelsDevError(t('settings.modelsDevRefreshFailed', { error: msg }))
            return
          }
        }

        let res = await api.listModelsDevProviders(q)
        if (!res.catalogAvailable && !opts?.forceRefresh) {
          // First open with no LKG: try one network refresh
          try {
            await api.refreshModelsDevCatalog()
            res = await api.listModelsDevProviders(q)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setModelsDevList([])
            setModelsDevMeta(null)
            setModelsDevError(t('settings.modelsDevRefreshFailed', { error: msg }))
            return
          }
        }
        setModelsDevList(res.providers)
        setModelsDevMeta(
          res.meta ? { fetchedAt: res.meta.fetchedAt, providerCount: res.meta.providerCount } : null,
        )
      } catch (e) {
        setModelsDevError(e instanceof Error ? e.message : String(e))
      } finally {
        setModelsDevLoading(false)
      }
    },
    [modelsDevQuery, t],
  )

  useEffect(() => {
    if (focusProviderId !== '__new__' || addProviderMode !== 'models-dev') return
    void loadModelsDevList()
  }, [focusProviderId, addProviderMode, loadModelsDevList])

  const importModelsDevProvider = async (providerId: string) => {
    setModelsDevImportingId(providerId)
    setModelsDevError(null)
    try {
      const res = await api.importModelsDevProvider(providerId)
      toastSuccess(t('settings.modelsDevImported', { name: res.provider.name }))
      await load()
      setFocusProviderId(res.provider.id)
      setEditingId(res.provider.id)
      setAddProviderMode('models-dev')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setModelsDevError(msg)
      toastError(msg)
    } finally {
      setModelsDevImportingId(null)
    }
  }

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

  /** Hand-built custom only — models.dev imports use built-in-style readonly UI. */
  const isHandCustomProvider = (p: SettingsProvider | undefined) => {
    if (!p?.custom) return false
    // Prefer payload source; fall back to customProviders list (IPC may omit on providers[])
    const source =
      p.source ?? customProviders.find((c) => c.id === p.id)?.source
    return source !== 'models.dev'
  }

  const isModelsDevProvider = (p: SettingsProvider | undefined) => {
    if (!p) return false
    const source =
      p.source ?? customProviders.find((c) => c.id === p.id)?.source
    return source === 'models.dev'
  }

  // When a hand-built custom provider is focused, keep the detail form hydrated.
  // models.dev imports use built-in-style readonly UI — do not open the edit form.
  useEffect(() => {
    if (!selectedProvider || focusProviderId === '__new__') return
    if (!isHandCustomProvider(selectedProvider)) return
    if (editingId === selectedProvider.id && form.name) return
    const cp = customProviders.find((c) => c.id === selectedProvider.id)
    if (cp) {
      startEdit(cp)
      return
    }
    setEditingId(selectedProvider.id)
    setForm({
      ...emptySimpleForm(),
      name: selectedProvider.name,
      baseURL: (selectedProvider as { baseURL?: string }).baseURL ?? '',
      apiStyle: (selectedProvider as { apiStyle?: ApiStyle }).apiStyle ?? 'openai',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedProvider?.id,
    selectedProvider?.custom,
    selectedProvider?.source,
    customProviders,
    focusProviderId,
  ])

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
    // Hand-built custom: editable form. Built-in + models.dev: readonly panel.
    if (isHandCustomProvider(p)) {
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
    toastSuccess(t('settings.defaultModelSet', { model: id }))
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

    // Keep an existing leader that belongs to this provider; first model
    // only wins when the provider is new or its previous leader is gone.
    const ownsLeader = next.models.some((m) => m.id === leaderModel)
    if (!ownsLeader) setLeaderModel(next.models[0]!.id)
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
      // Keep an existing leader that belongs to this provider; only fall back
      // to the first model when the previous leader is gone.
      const ownsLeader = nextList.some(
        (c) => c.id === next.id && c.models.some((m) => m.id === leaderModel),
      )
      const leaderToSave = ownsLeader ? leaderModel : next.models[0]!.id
      setLeaderModel(leaderToSave)
      setFocusProviderId(next.id)
      setEditingId(next.id)
      const secretsPayload = Object.keys(cleanSecrets).length ? cleanSecrets : undefined
      const saved = await saveSettings({
        leaderModel: leaderToSave,
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

  /**
   * Enable/disable any provider via settings.disabledProviderIds only.
   * Optimistic local flip only — no load(), no full providers merge, no switch disable
   * (those caused CDP-visible layout/switch flicker on OpenCode Go etc.).
   */
  const toggleProviderEnabled = async (
    provider: SettingsProvider,
    nextEnabled: boolean,
    opts?: { hasKeyDraft?: boolean },
  ) => {
    if (saving || deletingProvider || togglingProviderIdRef.current) return
    // Cannot turn on without a configured API key (draft key on custom form also counts).
    if (nextEnabled && !provider.configured && !opts?.hasKeyDraft) {
      toastError(t('settings.needKey'))
      return
    }
    const prevDisabled = data?.settings.disabledProviderIds ?? []
    const disabled = new Set(prevDisabled)
    if (nextEnabled) disabled.delete(provider.id)
    else disabled.add(provider.id)
    const disabledProviderIds = [...disabled]
    const prevData = data

    togglingProviderIdRef.current = provider.id
    if (editingId === provider.id) {
      setForm((f) => ({ ...f, enabled: nextEnabled }))
    }
    // Single optimistic patch: only this provider's enabled flag + disabled list.
    setData((d) => {
      if (!d) return d
      return {
        ...d,
        settings: { ...d.settings, disabledProviderIds },
        providers: d.providers.map((p) =>
          p.id === provider.id ? { ...p, enabled: nextEnabled } : p,
        ),
      }
    })

    try {
      const saved = await saveSettings({ disabledProviderIds })
      if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
      // Trust optimistic state. Do not re-merge providers[] — that rebuilt the whole
      // model rail/detail tree and looked like a layout reload under CDP.
    } catch (e) {
      if (prevData) setData(prevData)
      if (editingId === provider.id) {
        setForm((f) => ({ ...f, enabled: provider.enabled !== false }))
      }
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      togglingProviderIdRef.current = null
    }
  }

  /** Delete a disabled custom / models.dev provider: confirm → remove from list + persist. */
  const deleteCustomProvider = () => {
    if (deletingProvider) return
    const target = editingId ?? selectedProvider?.id
    if (!target || !customProviders.some((p) => p.id === target)) return
    const removed = customProviders.find((p) => p.id === target)!
    setPendingConfirm({
      title: t('settings.deleteProvider'),
      message: t('settings.deleteProviderConfirm', {
        name: form.name || selectedProvider?.name || target,
      }),
      confirmLabel: t('common.confirmDelete'),
      busyLabel: t('settings.deletingProvider'),
      cancelLabel: t('common.cancel'),
      danger: true,
      onConfirm: async () => {
        setDeletingProvider(true)
        setSaving(true)
        try {
          const nextList = customProviders.filter((p) => p.id !== target)
          // If it owned the active leader model, fall back to another provider
          const leaderWasDeleted = leaderModel.startsWith(`${target}/`)
          const nextLeader = leaderWasDeleted
            ? (data?.providers.find((p) => p.id !== target)?.models[0]?.id ?? leaderModel)
            : leaderModel
          // Drop the stored API key only when no other provider uses that env
          const stillUsed = (data?.providers ?? [])
            .filter((p) => p.id !== target)
            .some((p) =>
              Array.isArray(p.apiKeyEnv)
                ? p.apiKeyEnv.includes(removed.apiKeyEnv)
                : p.apiKeyEnv === removed.apiKeyEnv,
            )
          const secrets = stillUsed ? undefined : { [removed.apiKeyEnv]: null as string | null }
          removeCustom(target)
          if (leaderWasDeleted) setLeaderModel(nextLeader)
          const saved = await saveSettings({
            leaderModel: nextLeader,
            leaderMaxSteps: leaderMaxSteps ?? undefined,
            ...(secrets ? { secrets } : {}),
            customProviders: nextList,
          })
          if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
          setDraftKeys({})
          toastSuccess(t('settings.providerDeleted'))
          await load()
        } catch (e) {
          toastError(e instanceof Error ? e.message : String(e))
        } finally {
          setSaving(false)
          setDeletingProvider(false)
        }
      },
    })
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

  const savePromptSettings = async (prompts: PromptSettings) => {
    setPromptSaving(true)
    try {
      const normalized = normalizePromptSettings(prompts)
      const saved = await saveSettings({ prompts: normalized })
      if (saved.ok === false) return
      setPromptSettings(normalizePromptSettings(saved.settings?.prompts ?? normalized))
    } catch {
      // Silent auto-save (no toast).
    } finally {
      setPromptSaving(false)
    }
  }

  const saveWorkerTimeouts = async (next: WorkerTimeoutSettings) => {
    setWorkerTimeoutSaving(true)
    try {
      const saved = await saveSettings({ workerTimeouts: next })
      if (saved.ok === false) throw new Error(saved.error || t('settings.apiRestartFailed'))
      setWorkerTimeouts(saved.settings?.workerTimeouts ?? next)
    } catch {
      // Silent auto-save; keep last good value from props reload path.
    } finally {
      setWorkerTimeoutSaving(false)
    }
  }

  const npmRegistrySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (npmRegistrySaveTimer.current) clearTimeout(npmRegistrySaveTimer.current)
    }
  }, [])

  const persistNpmRegistry = async (raw: string, opts?: { notify?: boolean }) => {
    const { validateNpmRegistryDraft } = await import('../lib/npm-registry-url.js')
    const validated = validateNpmRegistryDraft(raw)
    if (!validated.ok) {
      setNpmRegistryError(
        validated.reason === 'space'
          ? t('settings.runtime.npmRegistryErrorSpace')
          : t('settings.runtime.npmRegistryErrorHttps'),
      )
      return
    }
    setNpmRegistryError(null)
    const nextValue = validated.value ?? ''
    const current = data?.settings.npmRegistry ?? ''
    if (nextValue === current) return
    setNpmRegistrySaving(true)
    try {
      const saved = await saveSettings({ npmRegistry: nextValue })
      if (saved.ok === false) return
      const stored = saved.settings?.npmRegistry ?? ''
      setNpmRegistryDraft(stored)
      setData((prev) =>
        prev
          ? {
              ...prev,
              settings: { ...prev.settings, npmRegistry: stored || undefined },
            }
          : prev,
      )
      if (opts?.notify) toastSuccess(t('settings.runtime.npmRegistryUpdated'))
    } catch {
      // Silent auto-save for typed input; preset path still shows toast only on success above.
    } finally {
      setNpmRegistrySaving(false)
    }
  }

  const onNpmRegistryChange = (raw: string) => {
    setNpmRegistryDraft(raw)
    if (npmRegistrySaveTimer.current) clearTimeout(npmRegistrySaveTimer.current)
    void import('../lib/npm-registry-url.js').then(({ validateNpmRegistryDraft }) => {
      const validated = validateNpmRegistryDraft(raw)
      if (!validated.ok) {
        setNpmRegistryError(
          validated.reason === 'space'
            ? t('settings.runtime.npmRegistryErrorSpace')
            : t('settings.runtime.npmRegistryErrorHttps'),
        )
        return
      }
      setNpmRegistryError(null)
      npmRegistrySaveTimer.current = setTimeout(() => {
        void persistNpmRegistry(raw)
      }, 400)
    })
  }

  const applyNpmRegistryPreset = (url: string) => {
    if (npmRegistrySaveTimer.current) {
      clearTimeout(npmRegistrySaveTimer.current)
      npmRegistrySaveTimer.current = null
    }
    setNpmRegistryDraft(url)
    setNpmRegistryError(null)
    void persistNpmRegistry(url, { notify: true })
  }

  const activeNpmPresetId = useMemo(
    () => matchNpmRegistryPreset(npmRegistryDraft),
    [npmRegistryDraft],
  )

  const npmPresetLabel = (id: NpmRegistryPresetId) =>
    t(
      (
        {
          system: 'settings.runtime.npmPreset.system',
          npmjs: 'settings.runtime.npmPreset.npmjs',
          yarn: 'settings.runtime.npmPreset.yarn',
          npmmirror: 'settings.runtime.npmPreset.npmmirror',
          huawei: 'settings.runtime.npmPreset.huawei',
          tencent: 'settings.runtime.npmPreset.tencent',
        } as const
      )[id],
    )

  const navItems: { id: TabId; label: string }[] = [
    { id: 'general', label: t('settings.navGeneral') },
    { id: 'model', label: t('settings.navModel') },
    { id: 'prompts', label: t('settings.navPrompts') },
    { id: 'workers', label: t('settings.navWorkers') },
    { id: 'about', label: t('settings.navAbout') },
  ]

  const tagText = (tag: string) => (locale === 'en' ? (TAG_EN[tag] ?? tag) : (TAG_ZH[tag] ?? tag))

  const selectedRegistryOption = useMemo(
    () => workerRegistry.find((o) => o.id === regSelectedId) ?? null,
    [workerRegistry, regSelectedId],
  )
  // Manual mode never falls through to Registry ownership, even if stale ids linger.
  const registrationRoute =
    regMode === 'manual'
      ? ({ kind: 'custom' } as const)
      : resolveWorkerRegistrationRoute(regSelectedId, selectedRegistryOption, regManifestDigest)
  const isRegistryPath = registrationRoute.kind !== 'custom'

  const switchRegisterMode = (mode: 'auto' | 'manual') => {
    if (mode === regMode) return
    setRegMode(mode)
    // Wipe all form fields on mode switch so neither side carries over the
    // other's partially-filled data (e.g. a registry selection's name leaking
    // into the manual form, or a manual command lingering in auto mode).
    clearRegistrationForm()
  }

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

  /** Clear every registration form field without side effects (no toast, no
   *  snapshot refresh). Used when opening the panel or switching modes so the
   *  user never sees stale data from a previous attempt. */
  const clearRegistrationForm = () => {
    setRegName('')
    setRegCommand('')
    setRegArgs('')
    setRegCustomLaunchKind('system')
    setRegEnv({})
    setRegDescription('')
    setRegIconAgentId(undefined)
    setRegIconUserPicked(false)
    setRegSelectedId(null)
    setRegManifestDigest('')
    setRegVersion('')
    setRegTrustNoSha(false)
    setRegDistribution('npx')
    setRegPrepareStatus(null)
    setPendingRegistryPrepare(null)
    setRegBusy(false)
  }

  const iconPickerOptions = useMemo(
    () => workerRegistry.map((o) => ({ id: o.id, name: o.name })),
    [workerRegistry],
  )

  const onManualIconChange = useCallback(
    (next: { iconAgentId: string | undefined; userPicked: boolean }) => {
      setRegIconAgentId(next.iconAgentId)
      setRegIconUserPicked(next.userPicked)
    },
    [],
  )

  const resetWorkerRegistration = () => {
    clearRegistrationForm()
    setRegMode('auto')
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
      const code = (error as { code?: string }).code
      const friendly =
        code === 'WORKER_DUPLICATE_REGISTRY'
          ? t('workers.registryDuplicate')
          : code === 'WORKER_DUPLICATE_NAME'
            ? t('workers.duplicateName')
            : null
      toastError(friendly ?? (error instanceof Error ? error.message : String(error)))
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
            enabled: false,
          },
        })
        operationStarted = true
        return
      } else {
        // Custom / manual path: probe first, then show the confirm dialog. The worker is only
        // persisted after the user confirms (handled in confirmCustomAcp below).
        if (!regCommand.trim()) return
        const args = regArgs.trim().split(/\s+/).filter(Boolean)
        const customInput: CustomAcpRegistrationInput = {
          name: regName.trim(),
          launchKind: regCustomLaunchKind,
          ...(regCustomLaunchKind === 'npx' || regCustomLaunchKind === 'uvx'
            ? { packageSpec: regCommand.trim() }
            : { command: regCommand.trim() }),
          args,
          env: Object.keys(regEnv).length > 0 ? regEnv : undefined,
          enabled: false,
          description: regDescription.trim() || undefined,
          // Always send: undefined auto-match is resolved by leaving the field off;
          // empty string clears; non-empty locks the user's pick (or current auto id).
          ...(regIconUserPicked || regIconAgentId !== undefined
            ? { iconAgentId: regIconAgentId ?? '' }
            : {}),
        }
        const { preview } = await api.previewCustomAcpWorker(customInput)
        setCustomPreview({ preview, input: customInput })
        operationStarted = true
        return
      }
      resetWorkerRegistration()
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
      setRegPrepareStatus(null)
    } finally {
      if (!operationStarted) setRegBusy(false)
    }
  }

  // User confirmed the custom-CLI preview dialog → persist with the chosen decision.
  const confirmCustomAcp = async (decision: {
    force?: boolean
    duplicateDecision?: 'add_anyway'
  }) => {
    const pending = customPreview
    if (!pending) return
    setCustomPreview(null)
    setRegBusy(true)
    try {
      await onRegisterCustomAcpWorker({ ...pending.input, ...decision })
      resetWorkerRegistration()
    } catch (e) {
      const code = (e as { code?: string }).code
      const friendly = code === 'WORKER_DUPLICATE_NAME' ? t('workers.duplicateName') : null
      toastError(friendly ?? (e instanceof Error ? e.message : String(e)))
    } finally {
      setRegBusy(false)
    }
  }

  // Toggle a worker's enabled flag. When turning ON, probe first so a worker
  // that fails ACP initialization (or needs auth) is not silently enabled.
  const toggleWorkerWithProbe = async (workerId: string, nextEnabled: boolean) => {
    if (!nextEnabled) {
      onToggleWorker?.(workerId, false)
      return
    }
    const target = workers.find((x) => x.id === workerId)
    if (!target) return
    // Already probed ready: just enable.
    const ready = target.readiness?.status === 'ready' || target.readiness?.status === 'degraded'
    if (ready) {
      onToggleWorker?.(workerId, true)
      return
    }
    // Not yet ready: probe first (probe works on disabled workers), then
    // enable only if it reaches ready/degraded.
    toastSuccess(t('workers.enablingProbe'))
    try {
      const { worker: after } = await api.probeRegistryWorker(workerId)
      const ok = after.readiness?.status === 'ready' || after.readiness?.status === 'degraded'
      if (ok) {
        onToggleWorker?.(workerId, true)
      } else if (after.readiness?.status === 'auth_required') {
        toastError(t('workers.enablingAuthRequired'))
      } else {
        toastError(
          after.readiness?.message
            ? `${after.readiness.status}: ${after.readiness.message}`
            : t('workers.enablingFailed'),
        )
      }
      onRefreshSnapshot?.()
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('workers.enablingFailed'))
    }
  }

  // Delete a worker after a native confirm. Refuses if the worker has open jobs or active team
  // members (the backend enforces this and returns a 409 with a clear message).
  const removeWorker = async (workerId: string, workerName: string) => {
    // Check team-member references first so the confirmation dialog can warn about the impact
    // (auto-archive) before the user commits, instead of surprising them afterwards.
    let referencedCount = 0
    try {
      const snap = await api.snapshot()
      referencedCount = (snap.teamMembers ?? []).filter(
        (tm) => tm.workerId === workerId && !tm.archivedAt,
      ).length
    } catch {
      /* proceed with the generic confirm if the lookup fails */
    }
    const message =
      referencedCount > 0
        ? t('workers.deleteConfirmReferenced', { name: workerName, count: referencedCount })
        : t('workers.deleteConfirm', { name: workerName })
    setPendingConfirm({
      title: t('workers.delete'),
      message,
      confirmLabel: t('common.confirmDelete'),
      cancelLabel: t('common.cancel'),
      danger: true,
      onConfirm: async () => {
        try {
          const result = await api.deleteWorker(workerId)
          onRefreshSnapshot?.()
          if ((result.archivedTeamMembers ?? 0) > 0) {
            toastSuccess(
              t('workers.deletedWithArchived', { count: result.archivedTeamMembers ?? 0 }),
            )
          } else {
            toastSuccess(t('workers.deleted'))
          }
        } catch (e) {
          const code = (e as { code?: string }).code
          const friendly =
            code === 'WORKER_HAS_OPEN_JOBS'
              ? t('workers.deleteErrorOpenJobs')
              : code === 'WORKER_REFERENCED_BY_ROLE'
                ? t('workers.deleteErrorReferenced')
                : t('workers.deleteErrorGeneric')
          toastError(friendly)
        }
      },
    })
  }

  const dangerActionCopy: Record<
    DangerZoneAction,
    { title: string; description: string; confirm: string }
  > = {
    'reset-settings': {
      title: t('settings.danger.resetSettingsTitle'),
      description: t('settings.danger.resetSettingsConfirm'),
      confirm: t('settings.danger.resetSettingsButton'),
    },
    'clear-workers-and-crews': {
      title: t('settings.danger.clearWorkersTitle'),
      description: t('settings.danger.clearWorkersConfirm'),
      confirm: t('settings.danger.clearWorkersButton'),
    },
    'clear-sessions': {
      title: t('settings.danger.clearSessionsTitle'),
      description: t('settings.danger.clearSessionsConfirm'),
      confirm: t('settings.danger.clearSessionsButton'),
    },
    'clear-cache': {
      title: t('settings.danger.clearCacheTitle'),
      description: t('settings.danger.clearCacheConfirm'),
      confirm: t('settings.danger.clearCacheButton'),
    },
    'reset-all': {
      title: t('settings.danger.resetAllTitle'),
      description: t('settings.danger.resetAllConfirm'),
      confirm: t('settings.danger.resetAllButton'),
    },
  }

  const dangerImpactLabel = (id: DangerImpactId): string => {
    switch (id) {
      case 'settings-basic':
        return t('settings.danger.impactSettingsBasic')
      case 'settings-prompts':
        return t('settings.danger.impactSettingsPrompts')
      case 'settings-models-keys':
        return t('settings.danger.impactSettingsModelsKeys')
      case 'cache':
        return t('settings.danger.impactCache')
      case 'workers':
        return t('settings.danger.workersCount')
      case 'workerSessions':
        return t('settings.danger.workerSessionsCount')
      case 'crews':
        return t('settings.danger.crewsCount')
      case 'chatSessions':
        return t('settings.danger.chatSessionsCount')
      case 'projects':
        return t('settings.danger.projectsCount')
    }
  }

  const dangerImpactList = (action: DangerZoneAction) => (
    <div className="settings-danger-impact-list" aria-label={t('settings.danger.impactLabel')}>
      {DANGER_ACTION_IMPACT_IDS[action].map((id) => {
        const statKey = DANGER_IMPACT_STAT_KEYS[id]
        const value = statKey ? dangerStats[statKey] : undefined
        return (
          <span key={id} className="settings-danger-impact-chip">
            <span>{dangerImpactLabel(id)}</span>
            {value !== undefined && <b>{value}</b>}
          </span>
        )
      })}
    </div>
  )

  const openDangerWarning = () => {
    setPendingConfirm({
      title: t('settings.danger.warningTitle'),
      message: (
        <div className="settings-danger-confirm settings-danger-warning-confirm">
          <p>{t('settings.danger.warning')}</p>
        </div>
      ),
      confirmLabel: t('settings.danger.warningConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
      onConfirm: async () => {
        setDangerOpen(true)
      },
    })
  }

  const toggleDangerZone = () => {
    const intent = resolveDangerZoneToggleIntent(dangerOpen)
    if (intent === 'close') {
      setDangerOpen(false)
    } else {
      openDangerWarning()
    }
  }

  const requestDangerAction = (action: DangerZoneAction) => {
    const copy = dangerActionCopy[action]
    setPendingConfirm({
      title: copy.title,
      message: (
        <div className="settings-danger-confirm">
          <p>{copy.description}</p>
          {dangerImpactList(action)}
        </div>
      ),
      confirmLabel: copy.confirm,
      cancelLabel: t('common.cancel'),
      danger: true,
      onConfirm: async () => {
        setDangerBusy(action)
        try {
          const result = await performDangerZoneAction(action)
          const rendererReset = action === 'reset-settings' || action === 'reset-all'
          if (result.ok === false && !rendererReset) {
            throw new Error(result.error ?? t('settings.danger.actionFailed'))
          }
          onRefreshSnapshot?.()
          if (rendererReset) {
            resetRendererPreferences()
            window.setTimeout(() => window.location.reload(), 0)
          } else {
            toastSuccess(t('settings.danger.actionCompleted'))
          }
        } catch (error) {
          toastError(error instanceof Error ? error.message : t('settings.danger.actionFailed'))
        } finally {
          setDangerBusy(null)
        }
      },
    })
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
                <div className="lbl">{t('settings.colorMode')}</div>
                <div className="sub">{t('settings.colorModeDesc')}</div>
              </div>
              <SettingsSelect
                value={themeMode}
                onChange={(v) => setThemeMode(v as 'system' | 'light' | 'dark')}
                aria-label={t('settings.colorMode')}
                options={[
                  { value: 'system', label: t('appearance.system') },
                  { value: 'light', label: t('appearance.light') },
                  { value: 'dark', label: t('appearance.dark') },
                ]}
              />
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.lightTheme')}</div>
                <div className="sub">{t('settings.lightThemeDesc')}</div>
              </div>
              <SettingsSelect
                value={lightThemeId}
                onChange={setLightThemeId}
                aria-label={t('settings.lightTheme')}
                options={displayLightThemes.map((theme) => ({
                  value: theme.id,
                  label: theme.name,
                }))}
              />
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.darkTheme')}</div>
                <div className="sub">{t('settings.darkThemeDesc')}</div>
              </div>
              <SettingsSelect
                value={darkThemeId}
                onChange={setDarkThemeId}
                aria-label={t('settings.darkTheme')}
                options={displayDarkThemes.map((theme) => ({
                  value: theme.id,
                  label: theme.name,
                }))}
              />
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.reloadThemes')}</div>
                <div className="sub">
                  {themesDirectory
                    ? `${t('settings.reloadThemesDesc')} · ${themesDirectory}`
                    : t('settings.reloadThemesDesc')}
                </div>
              </div>
              <button
                type="button"
                className="settings-btn-soft"
                onClick={() => void reloadColorThemes()}
                disabled={themesLoading || reloadThemesUiBusy}
              >
                {themesLoading || reloadThemesUiBusy
                  ? t('settings.reloadThemesLoading')
                  : t('settings.reloadThemesButton')}
              </button>
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.language')}</div>
                <div className="sub">{t('settings.languageDesc')}</div>
              </div>
              <SettingsSelect
                value={locale}
                onChange={(v) => setLocale(v as Locale)}
                aria-label={t('settings.language')}
                options={[
                  { value: 'zh', label: t('lang.zh') },
                  { value: 'zh-TW', label: t('lang.zh-TW') },
                  { value: 'en', label: t('lang.en') },
                ]}
              />
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.sendShortcut')}</div>
                <div className="sub">{t('settings.sendShortcutDesc')}</div>
              </div>
              <SettingsSelect
                value={sendShortcut}
                onChange={(v) => setSendShortcut(v as SendShortcut)}
                aria-label={t('settings.sendShortcut')}
                options={[
                  { value: 'enter', label: t('settings.sendShortcutEnter') },
                  { value: 'mod-enter', label: t('settings.sendShortcutModEnter') },
                ]}
              />
            </div>
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t('settings.motion')}</div>
                <div className="sub">{t('settings.motionDesc')}</div>
              </div>
              <SettingsSelect
                value={motionPreference}
                onChange={(v) => setMotionPreference(v as MotionPreference)}
                aria-label={t('settings.motion')}
                options={[
                  { value: 'system', label: t('settings.motionSystem') },
                  { value: 'on', label: t('settings.motionOn') },
                  { value: 'off', label: t('settings.motionOff') },
                ]}
              />
            </div>
          </div>
          <WorkerTimeoutSettingsEditor
            value={workerTimeouts}
            saving={workerTimeoutSaving}
            onSave={saveWorkerTimeouts}
            leaderMaxSteps={leaderMaxSteps ?? 500}
            leaderMaxStepsSaving={saving}
            onSaveLeaderMaxSteps={async (steps) => {
              setSaving(true)
              setLeaderMaxStepsError(null)
              setLeaderMaxStepsDraft(String(steps))
              try {
                const saved = await saveSettings({ leaderMaxSteps: steps })
                if (saved.ok === false) return
                setLeaderMaxSteps(saved.leaderMaxSteps ?? saved.settings?.leaderMaxSteps ?? steps)
              } catch {
                // Silent auto-save.
              } finally {
                setSaving(false)
              }
            }}
          />
          <div className="settings-form-card settings-runtime-card">
            <header className="settings-card-head">
              <div className="settings-card-titles">
                <h3 className="settings-card-title">{t('settings.runtime.npmRegistry')}</h3>
                <p className="settings-card-desc">{t('settings.runtime.npmRegistryDesc')}</p>
              </div>
            </header>
            <div className="settings-runtime-rows">
              <div className="settings-row-block settings-npm-registry-block">
                <div className="settings-field" style={{ margin: 0 }}>
                  <span className="field-label">{t('settings.runtime.npmPresets')}</span>
                  <div
                    className="npm-registry-presets"
                    role="group"
                    aria-label={t('settings.runtime.npmPresets')}
                  >
                    {NPM_REGISTRY_PRESETS.map((preset) => {
                      const active = activeNpmPresetId === preset.id
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`npm-registry-preset-chip${active ? ' is-active' : ''}`}
                          disabled={npmRegistrySaving}
                          aria-pressed={active}
                          title={preset.url || t('settings.runtime.npmPreset.system')}
                          onClick={() => applyNpmRegistryPreset(preset.url)}
                        >
                          <span className="npm-registry-preset-label">
                            {npmPresetLabel(preset.id)}
                          </span>
                          {preset.region === 'cn' && (
                            <span className="npm-registry-preset-region">
                              {t('settings.runtime.npmPresetRegion.cn')}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <label className="settings-field" style={{ margin: 0 }}>
                  <span className="field-label">{t('settings.runtime.npmRegistryUrl')}</span>
                  <input
                    type="url"
                    className="settings-input ui-font"
                    value={npmRegistryDraft}
                    placeholder={t('settings.runtime.npmRegistryPh')}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={npmRegistrySaving}
                    onChange={(e) => onNpmRegistryChange(e.target.value)}
                    onBlur={() => {
                      if (npmRegistrySaveTimer.current) {
                        clearTimeout(npmRegistrySaveTimer.current)
                        npmRegistrySaveTimer.current = null
                      }
                      void persistNpmRegistry(npmRegistryDraft)
                    }}
                    aria-label={t('settings.runtime.npmRegistry')}
                  />
                </label>
                {npmRegistryError && <p className="settings-error">{npmRegistryError}</p>}
              </div>
            </div>
          </div>
          <section className="settings-danger-zone" aria-label={t('settings.danger.title')}>
            <button
              type="button"
              className="settings-danger-zone-toggle"
              aria-expanded={dangerOpen}
              onClick={toggleDangerZone}
            >
              <span>
                <strong>{t('settings.danger.title')}</strong>
                <small>{t('settings.danger.collapsedDesc')}</small>
              </span>
              <span className="settings-danger-zone-chevron" aria-hidden />
            </button>
            <Expandable open={dangerOpen}>
              <div className="settings-danger-zone-body">
                <p className="settings-danger-zone-warning">{t('settings.danger.warning')}</p>
                <div className="settings-danger-overview" aria-live="polite">
                  {(
                    [
                      ['projects', t('settings.danger.projectsCount')],
                      ['workers', t('settings.danger.workersCount')],
                      ['workerSessions', t('settings.danger.workerSessionsCount')],
                      ['crews', t('settings.danger.crewsCount')],
                      ['chatSessions', t('settings.danger.chatSessionsCount')],
                    ] as const
                  ).map(([key, label]) => (
                    <span key={key} className="settings-danger-metric">
                      <b>{dangerStats[key]}</b>
                      <small>{label}</small>
                    </span>
                  ))}
                </div>
                <div className="settings-danger-actions">
                  {(
                    [
                      'reset-settings',
                      'clear-workers-and-crews',
                      'clear-sessions',
                      'clear-cache',
                      'reset-all',
                    ] as DangerZoneAction[]
                  ).map((action) => (
                    <div key={action} className="settings-danger-action-card">
                      <div className="settings-danger-action-copy">
                        <h4>{dangerActionCopy[action].title}</h4>
                        <p>
                          {action === 'reset-settings'
                            ? t('settings.danger.resetSettingsDesc')
                            : action === 'clear-workers-and-crews'
                              ? t('settings.danger.clearWorkersDesc')
                              : action === 'clear-sessions'
                                ? t('settings.danger.clearSessionsDesc')
                                : action === 'clear-cache'
                                  ? t('settings.danger.clearCacheDesc')
                                  : t('settings.danger.resetAllDesc')}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="settings-danger-action-button"
                        disabled={dangerBusy !== null}
                        onClick={() => requestDangerAction(action)}
                      >
                        {dangerActionCopy[action].confirm}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </Expandable>
          </section>
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
                // Built-in policy + models.dev imports (catalog installs live under 内置)
                .filter((p) => !p.custom || isModelsDevProvider(p))
                .map((p) => {
                  const active = selectedProvider?.id === p.id && focusProviderId !== '__new__'
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`settings-rail-item${active ? ' active' : ''}`}
                      onClick={() => pickProvider(p)}
                    >
                      <span className="settings-rail-icon" aria-hidden>
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
                .filter((p) => isHandCustomProvider(p))
                .map((p) => {
                  const active =
                    (selectedProvider?.id === p.id || editingId === p.id) &&
                    focusProviderId !== '__new__'
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`settings-rail-item${active ? ' active' : ''}`}
                      onClick={() => pickProvider(p)}
                    >
                      <span className="settings-rail-icon" aria-hidden>
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
                  setAddProviderMode('models-dev')
                  setModelsDevQuery('')
                  setModelsDevError(null)
                  setFocusProviderId('__new__')
                }}
              >
                + {t('settings.addProvider')}
              </button>
            </aside>

            <div className="settings-model-main">
              {focusProviderId === '__new__' ? (
                <>
                  <div className="settings-provider-head">
                    <div className="pname">{t('settings.addProvider')}</div>
                  </div>
                  <div className="add-provider-mode-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={addProviderMode === 'models-dev'}
                      className={addProviderMode === 'models-dev' ? 'active' : ''}
                      onClick={() => setAddProviderMode('models-dev')}
                    >
                      {t('settings.addFromModelsDev')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={addProviderMode === 'custom'}
                      className={addProviderMode === 'custom' ? 'active' : ''}
                      onClick={() => setAddProviderMode('custom')}
                    >
                      {t('settings.addCustomGateway')}
                    </button>
                  </div>

                  {addProviderMode === 'models-dev' ? (
                    <div className="models-dev-import">
                      <p className="settings-field-hint">{t('settings.modelsDevHint')}</p>
                      <div className="models-dev-toolbar">
                        <input
                          className="settings-input"
                          value={modelsDevQuery}
                          onChange={(e) => setModelsDevQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void loadModelsDevList({ q: modelsDevQuery })
                            }
                          }}
                          placeholder={t('settings.modelsDevSearchPh')}
                          aria-label={t('settings.modelsDevSearchPh')}
                        />
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={modelsDevLoading}
                          onClick={() => void loadModelsDevList({ q: modelsDevQuery })}
                        >
                          {t('settings.modelsDevSearch')}
                        </button>
                        <button
                          type="button"
                          className="settings-save-btn"
                          disabled={modelsDevLoading}
                          onClick={() => void loadModelsDevList({ forceRefresh: true, q: modelsDevQuery })}
                        >
                          {modelsDevLoading ? t('app.loading') : t('settings.modelsDevRefresh')}
                        </button>
                      </div>
                      {modelsDevMeta && (
                        <p className="settings-muted models-dev-meta">
                          {t('settings.modelsDevMeta', {
                            count: String(modelsDevMeta.providerCount),
                            at: new Date(modelsDevMeta.fetchedAt).toLocaleString(),
                          })}
                        </p>
                      )}
                      {modelsDevError && (
                        <p className="settings-error" role="alert">
                          {modelsDevError}
                        </p>
                      )}
                      <div className="models-dev-list" role="listbox" aria-label={t('settings.addFromModelsDev')}>
                        {modelsDevList.map((p) => (
                          <div key={p.id} className="models-dev-row" role="option">
                            <span className="logo models-dev-row-logo" aria-hidden>
                              <ProviderLogo providerId={p.id} size={16} />
                            </span>
                            <span className="models-dev-row-text">
                              <span className="models-dev-row-name">{p.name}</span>
                              <span className="models-dev-row-meta">
                                {p.id} · {t('settings.modelsDevModelCount', { n: String(p.modelCount) })}
                                {p.needsBaseURL && p.api ? ` · ${p.api}` : ''}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="settings-save-btn btn-sm"
                              disabled={saving || modelsDevImportingId === p.id}
                              onClick={() => void importModelsDevProvider(p.id)}
                            >
                              {modelsDevImportingId === p.id
                                ? t('app.loading')
                                : t('settings.modelsDevAdd')}
                            </button>
                          </div>
                        ))}
                        {!modelsDevLoading && modelsDevList.length === 0 && !modelsDevError && (
                          <p className="settings-muted">{t('settings.modelsDevEmpty')}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="settings-field">
                        <label>{t('settings.customName')}</label>
                        <input
                          className="settings-input"
                          value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder={t('settings.customNamePh')}
                        />
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
                                apiStyle: e.target.value as ApiStyle,
                              }))
                            }
                            aria-label={t('settings.apiStyle')}
                          >
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="google">Google</option>
                            <option value="custom">Custom</option>
                          </select>
                        </div>
                      </div>
                      <div className="settings-field">
                        <label>{t('settings.customApiKey')}</label>
                        <input
                          type="password"
                          className="settings-input"
                          autoComplete="off"
                          value={form.apiKey}
                          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                          placeholder={t('settings.enterKey')}
                        />
                      </div>
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
                    </>
                  )}
                </>
              ) : isHandCustomProvider(selectedProvider) ||
                (editingId &&
                  customProviders.some(
                    (c) => c.id === editingId && c.source !== 'models.dev',
                  )) ? (
                <>
                  <div className="settings-provider-head">
                    <div className="pname">
                      {form.name || selectedProvider?.name || t('settings.editCustom')}
                    </div>
                    {focusProviderId !== '__new__' && selectedProvider && (
                      <button
                        type="button"
                        className={`enable-switch${
                          selectedProvider.enabled !== false &&
                          (selectedProvider.configured || Boolean(form.apiKey.trim()))
                            ? ' is-on'
                            : ''
                        }`}
                        role="switch"
                        aria-checked={
                          selectedProvider.enabled !== false &&
                          (selectedProvider.configured || Boolean(form.apiKey.trim()))
                        }
                        title={
                          !selectedProvider.configured && !form.apiKey.trim()
                            ? t('settings.needKey')
                            : t('settings.enableProvider')
                        }
                        aria-label={t('settings.enableProvider')}
                        disabled={saving || deletingProvider}
                        onClick={() => {
                          const currentlyOn =
                            selectedProvider.enabled !== false &&
                            (selectedProvider.configured || Boolean(form.apiKey.trim()))
                          void toggleProviderEnabled(selectedProvider, !currentlyOn, {
                            hasKeyDraft: Boolean(form.apiKey.trim()),
                          })
                        }}
                      >
                        <span className="enable-switch-knob" aria-hidden />
                      </button>
                    )}
                    <span className="spacer" />
                    {focusProviderId !== '__new__' && !form.enabled && (
                      <button
                        type="button"
                        className="settings-delete-link"
                        disabled={saving || deletingProvider}
                        onClick={deleteCustomProvider}
                      >
                        {deletingProvider
                          ? t('settings.deletingProvider')
                          : t('settings.deleteProvider')}
                      </button>
                    )}
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
                              .thinkingIntensities ?? DEFAULT_CUSTOM_THINKING_SUPPORT
                          return (
                              <div
                                key={m.id}
                                className={`model-card${active ? ' is-default' : ''}${isEditing ? ' editing' : ''}`}
                              >
                                <div
                                  className="model-card-head"
                                  onClick={() => {
                                    // 点击卡片只切换编辑态；设默认走独立按钮，避免与编辑选中混淆
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
                                    {(m as { toolCall?: boolean }).toolCall && (
                                      <span className="model-tag">{t('settings.modelTagTools')}</span>
                                    )}
                                    {(m as { multimodal?: boolean }).multimodal && (
                                      <span className="model-tag">
                                        {t('settings.modelTagMultimodal')}
                                      </span>
                                    )}
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
                                {!active && !isEditing && (
                                  <button
                                    type="button"
                                    className="set-default-btn"
                                    disabled={saving}
                                    onClick={() => pickModel(m.id)}
                                  >
                                    {t('settings.setDefaultModel')}
                                  </button>
                                )}
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
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setEditModelForm((f) => {
                                                const set = new Set(f.thinkingIntensities)
                                                if (set.has(level)) set.delete(level)
                                                else set.add(level)
                                                const next = THINKING_INTENSITY_OPTIONS.filter(
                                                  (l) => set.has(l),
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
                  </section>
                </>
              ) : (
                <>
                  <div className="settings-provider-head">
                    <div className="pname">
                      {selectedProvider && (
                        <span className="logo settings-provider-head-logo" aria-hidden>
                          <ProviderLogo providerId={selectedProvider.id} size={14} />
                        </span>
                      )}
                      {selectedProvider?.name ?? '—'}
                      {isModelsDevProvider(selectedProvider) && (
                        <span className="provider-source-badge">models.dev</span>
                      )}
                    </div>
                    {/* 目录供应商：已配置 Key 且未手动关闭才显示开启；无 Key 不能开 */}
                    <button
                      type="button"
                      className={`enable-switch${
                        selectedProvider?.enabled !== false && selectedProvider?.configured
                          ? ' is-on'
                          : ''
                      }`}
                      role="switch"
                      aria-checked={
                        selectedProvider?.enabled !== false &&
                        Boolean(selectedProvider?.configured)
                      }
                      title={
                        selectedProvider && !selectedProvider.configured
                          ? t('settings.needKey')
                          : t('settings.enableProvider')
                      }
                      aria-label={t('settings.enableProvider')}
                      disabled={!selectedProvider || saving || deletingProvider}
                      onClick={() => {
                        if (!selectedProvider) return
                        const currentlyOn =
                          selectedProvider.enabled !== false && selectedProvider.configured
                        // 开启且无 Key → toggle 内 toast needKey
                        void toggleProviderEnabled(selectedProvider, !currentlyOn)
                      }}
                    >
                      <span className="enable-switch-knob" aria-hidden />
                    </button>
                    <span className="spacer" />
                    {isModelsDevProvider(selectedProvider) && (
                      <button
                        type="button"
                        className="settings-delete-link"
                        disabled={saving || deletingProvider}
                        onClick={() => void deleteCustomProvider()}
                      >
                        {deletingProvider
                          ? t('settings.deletingProvider')
                          : t('settings.deleteProvider')}
                      </button>
                    )}
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
                        const meta = m as {
                          thinkingIntensities?: ThinkingIntensity[]
                          toolCall?: boolean
                          multimodal?: boolean
                        }
                        const thinks = meta.thinkingIntensities ?? selectedProvider?.thinkingIntensities
                        return (
                          <div key={m.id} className={`model-card${active ? ' is-default' : ''}`}>
                            <div className="model-card-head">
                              <span className="m-mid">
                                <span className="m-name">{m.label}</span>
                                <span className="m-id">{m.id}</span>
                              </span>
                              <span className="meta">
                                {meta.toolCall && (
                                  <span className="model-tag">{t('settings.modelTagTools')}</span>
                                )}
                                {meta.multimodal && (
                                  <span className="model-tag">
                                    {t('settings.modelTagMultimodal')}
                                  </span>
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
                                onClick={() => pickModel(m.id)}
                              >
                                {t('settings.setDefaultModel')}
                              </button>
                            )}
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

      {!loading && tab === 'prompts' && (
        <div className="settings-prompts-page">
          <h2 className="settings-page-title">{t('settings.navPrompts')}</h2>
          <p className="settings-page-desc">{t('settings.descPrompts')}</p>
          <PromptSettingsEditor
            prompts={promptSettings}
            saving={promptSaving}
            onChange={setPromptSettings}
            onSave={savePromptSettings}
          />
        </div>
      )}

      {!loading && tab === 'workers' && (
        <div className="settings-model-page settings-workers-page">
          <h2 className="settings-page-title">{t('settings.navWorkers')}</h2>
          <p className="settings-page-desc">{t('settings.descWorkers')}</p>
          <div className="settings-model-layout">
            {/* ── Left rail: Agents + Crews ── */}
            <aside className="settings-provider-rail" aria-label={t('settings.navWorkers')}>
              <div className="settings-rail-label">
                <span>{t('workers.railAgents')}</span>
                <button
                  type="button"
                  className={`settings-rail-add${railFocus?.type === 'register' ? ' active' : ''}`}
                  onClick={() => {
                    clearRegistrationForm()
                    setRegOpen(true)
                    setRegMode('auto')
                    setRailFocus({ type: 'register' })
                  }}
                >
                  {t('workers.register')}
                </button>
              </div>
              {workers.map((w) => {
                const active = railFocus?.type === 'agent' && railFocus.id === w.id
                return (
                  <button
                    key={w.id}
                    type="button"
                    className={`settings-rail-item${active ? ' active' : ''}`}
                    onClick={() => setRailFocus({ type: 'agent', id: w.id })}
                  >
                    <span
                      className={`settings-rail-icon worker-logo ${workerLogoClass(w.kind)}`}
                      aria-hidden
                    >
                      <WorkerBrandLogo
                        kind={w.kind}
                        name={w.name}
                        size={16}
                        workerId={w.id}
                        hasIcon={Boolean(w.iconPath)}
                        iconAgentId={resolveWorkerIconAgentId(w)}
                      />
                    </span>
                    <span className="settings-rail-text">
                      <span className="settings-rail-name">{w.name}</span>
                    </span>
                    <span
                      className={`settings-rail-dot${w.enabled && w.health === 'healthy' ? ' on' : ''}`}
                      title={w.enabled ? t('workers.health.healthy') : t('workers.health.unknown')}
                    />
                  </button>
                )
              })}

              <div className="settings-rail-label settings-rail-label--section">
                <span>{t('workers.railCrews')}</span>
                <button
                  type="button"
                  className="settings-rail-add"
                  onClick={async () => {
                    try {
                      const { template } = await api.createTeamTemplate({
                        name: t('workers.newCrewName'),
                        members: [],
                      })
                      setTeamTemplates((prev) => [...prev, template])
                      setRailFocus({ type: 'crew', id: template.id })
                    } catch (e) {
                      toastError(e instanceof Error ? e.message : String(e))
                    }
                  }}
                >
                  {t('workers.newCrew')}
                </button>
              </div>
              {teamTemplates.map((tmpl) => {
                const active = railFocus?.type === 'crew' && railFocus.id === tmpl.id
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    className={`settings-rail-item${active ? ' active' : ''}`}
                    onClick={() => setRailFocus({ type: 'crew', id: tmpl.id })}
                  >
                    <span className="settings-rail-icon" aria-hidden>
                      <IconCrew size={16} />
                    </span>
                    <span className="settings-rail-text">
                      <span className="settings-rail-name">{tmpl.name}</span>
                    </span>
                    <span className="settings-rail-meta">{tmpl.members.length}</span>
                  </button>
                )
              })}
            </aside>

            {/* ── Right main panel ── */}
            <div className="settings-model-main">
              {/* Agent detail */}
              {railFocus?.type === 'agent' &&
                (() => {
                  const w = workers.find((x) => x.id === railFocus.id)
                  if (!w) return <p className="settings-muted">{t('workers.empty')}</p>
                  const cs = w.capabilitySummary
                  const terminalMethod = cs?.authMethods?.find((m) => m.type === 'terminal')
                  const agentMethod = cs?.authMethods?.find((m) => m.type === 'agent')
                  const envMethod = cs?.authMethods?.find((m) => m.type === 'env_var')
                  const authActive =
                    agentAuthOperation?.workerId === w.id ? agentAuthOperation.snapshot : null
                  const sourceStr = w.source ? (w.source as { type?: string }).type : undefined
                  const sourceLabel =
                    w.source?.type === 'registry'
                      ? `registry · ${w.source.distribution}`
                      : w.source?.type === 'custom'
                        ? `custom · ${w.source.launchKind}`
                        : (sourceStr ?? '—')
                  const pathLabel = w.launchSpec?.executable ?? w.command ?? '—'
                  // Command shown to the user. If w.command is a bare name
                  // (no path separator), prefix it with the resolved executable
                  // path so the displayed command is unambiguous (e.g.
                  // "~/.kimi-code/bin/kimi acp" instead of just "kimi acp").
                  const commandParts = [w.command, ...(w.args ?? [])].filter(Boolean)
                  const commandIsBare = w.command ? !w.command.includes('/') : true
                  const commandLabel =
                    commandIsBare && w.launchSpec?.executable && w.command
                      ? [w.launchSpec.executable, ...(w.args ?? [])].filter(Boolean).join(' ')
                      : commandParts.join(' ') || '—'
                  return (
                    <div className="worker-detail">
                      {/* Header */}
                      <div className="settings-provider-head">
                        <span
                          className={`worker-logo ${workerLogoClass(w.kind)}`}
                          title={w.name}
                          aria-hidden
                        >
                          <WorkerBrandLogo
                            kind={w.kind}
                            name={w.name}
                            size={20}
                            workerId={w.id}
                            hasIcon={Boolean(w.iconPath)}
                            iconAgentId={resolveWorkerIconAgentId(w)}
                          />
                        </span>
                        <div className="worker-detail-titles">
                          <h3 className="settings-card-title">{w.name}</h3>
                          <WorkerDefaultRoleTypeEditor
                            worker={w}
                            onSave={async (roleType) => {
                              try {
                                await onSetWorkerDefaultRoleType(w.id, roleType)
                                toastSuccess(t('workers.defaultRoleUpdated'))
                              } catch (error) {
                                toastError(error instanceof Error ? error.message : String(error))
                              }
                            }}
                          />
                          <button
                            type="button"
                            className={`switch toggle${w.enabled ? ' on' : ''}`}
                            role="switch"
                            aria-checked={w.enabled}
                            aria-label={t('workers.formEnabled')}
                            onClick={() => void toggleWorkerWithProbe(w.id, !w.enabled)}
                          />
                        </div>
                        <div className="worker-detail-head-actions">
                          <button
                            type="button"
                            className="worker-card-delete-link"
                            title={
                              !w.enabled
                                ? t('workers.deleteWorker')
                                : t('workers.deleteDisabledHint')
                            }
                            disabled={w.enabled}
                            onClick={() => void removeWorker(w.id, w.name)}
                          >
                            {t('workers.deleteWorker')}
                          </button>
                        </div>
                      </div>

                      {/* 2-column card grid */}
                      <div className="worker-detail-grid">
                        {/* Identity card */}
                        <div className="worker-detail-card worker-info-card">
                          <h4 className="worker-detail-card-title">
                            {t('workers.sectionIdentity')}
                          </h4>
                          <div className="worker-info-row">
                            <span className="worker-info-label">{t('workers.fieldVersion')}</span>
                            <span className="worker-info-value">
                              {[
                                w.source?.type === 'registry'
                                  ? w.source.registryVersion
                                  : cs?.agentVersion,
                                cs?.protocolVersion ? `ACP ${cs.protocolVersion}` : null,
                              ]
                                .filter(Boolean)
                                .join(' / ') || '—'}
                            </span>
                          </div>
                          <div className="worker-info-row">
                            <span className="worker-info-label">{t('workers.fieldCommand')}</span>
                            <WorkerCommandField command={commandLabel} />
                          </div>
                          <div className="worker-info-row">
                            <span className="worker-info-label">{t('workers.fieldSource')}</span>
                            <span className="worker-info-value">{sourceLabel}</span>
                          </div>
                          <div className="worker-info-row">
                            <span className="worker-info-label">{t('workers.sectionAuth')}</span>
                            <span className="worker-info-value">
                              {cs?.authMethods && cs.authMethods.length > 0
                                ? cs.authMethods
                                    .map((m) => `${m.name ?? m.id} (${m.type})`)
                                    .join(', ')
                                : '—'}
                            </span>
                          </div>
                          {(w.readiness?.status === 'auth_required' || authActive) && (
                            <div className="worker-auth-actions">
                              {terminalMethod && (
                                <button
                                  type="button"
                                  className="settings-btn-soft btn-sm"
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
                              {agentMethod && !authActive && (
                                <button
                                  type="button"
                                  className="settings-btn-soft btn-sm"
                                  disabled={Boolean(agentAuthOperation)}
                                  onClick={() =>
                                    void startAgentAuthentication(w.id, agentMethod.id)
                                  }
                                >
                                  {t('workers.authAgent')}
                                </button>
                              )}
                              {authActive && (
                                <>
                                  <span className="settings-field-hint">
                                    {authActive.status === 'queued'
                                      ? t('workers.authQueued')
                                      : t('workers.authRunning')}
                                  </span>
                                  <button
                                    type="button"
                                    className="settings-btn-soft btn-sm"
                                    onClick={() => void cancelAgentAuthentication()}
                                  >
                                    {t('workers.authCancel')}
                                  </button>
                                </>
                              )}
                              {Boolean(envMethod?.envVarNames?.length) && (
                                <button
                                  type="button"
                                  className="settings-btn-soft btn-sm"
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
                          )}
                          {secretEditor?.workerId === w.id && (
                            <form
                              className="worker-secret-editor"
                              onSubmit={(event) => void saveWorkerSecrets(event)}
                            >
                              <h4 className="settings-card-title">
                                {t('workers.secretTitle', { name: secretEditor.workerName })}
                              </h4>
                              {secretEditor.envVarNames.map((name) => (
                                <div key={name} className="settings-field">
                                  <label className="field-label mono">{name}</label>
                                  <input
                                    className="settings-input mono"
                                    type="password"
                                    placeholder={t('workers.secretPlaceholder')}
                                    value={secretDraft[name] ?? ''}
                                    onChange={(e) =>
                                      setSecretDraft((prev) => ({
                                        ...prev,
                                        [name]: e.target.value,
                                      }))
                                    }
                                  />
                                </div>
                              ))}
                              <div className="model-edit-actions">
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={closeSecretEditor}
                                >
                                  {t('prompt.cancel')}
                                </button>
                                <button
                                  type="submit"
                                  className="settings-save-btn"
                                  disabled={secretBusy}
                                >
                                  {secretBusy ? t('app.loading') : t('settings.save')}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>

                        {/* Health card */}
                        <div className="worker-detail-card">
                          <div className="worker-detail-card-head">
                            <h4 className="worker-detail-card-title">
                              {t('workers.sectionHealth')}
                            </h4>
                            {w.readiness && (
                              <WorkerReadinessBadge
                                status={w.readiness.status}
                                code={w.readiness.code}
                                nextAction={w.readiness.nextAction}
                                locale={locale === 'en' ? 'en' : 'zh'}
                              />
                            )}
                          </div>
                          <div className="worker-health-row">
                            <span className="worker-health-label">{t('workers.healthCli')}</span>
                            <span
                              className={`worker-health-value ${
                                w.commandHealth?.status === 'healthy' || w.cliHealth === 'healthy'
                                  ? 'ok'
                                  : w.cliHealth === 'unhealthy'
                                    ? 'bad'
                                    : 'warn'
                              }`}
                            >
                              {w.commandHealth?.status ?? w.cliHealth ?? 'unknown'}
                            </span>
                          </div>
                          <div className="worker-health-row">
                            <span className="worker-health-label">{t('workers.healthAcp')}</span>
                            <span
                              className={`worker-health-value ${
                                w.acpHealth?.status === 'ready'
                                  ? 'ok'
                                  : w.acpHealth?.status === 'degraded'
                                    ? 'warn'
                                    : w.acpHealth?.status === 'unavailable'
                                      ? 'bad'
                                      : ''
                              }`}
                            >
                              {w.acpHealth?.status ?? 'unknown'}
                            </span>
                          </div>
                          <div className="worker-health-row">
                            <span className="worker-health-label">{t('workers.healthProbed')}</span>
                            <span className="worker-health-value">
                              {cs?.probedAt
                                ? new Date(cs.probedAt).toLocaleString(
                                    locale === 'zh'
                                      ? 'zh-CN'
                                      : locale === 'zh-TW'
                                        ? 'zh-TW'
                                        : 'en-US',
                                  )
                                : '—'}
                            </span>
                          </div>
                          <div className="worker-health-row">
                            <span className="worker-health-label">{t('workers.healthModels')}</span>
                            <span className="worker-health-value">
                              {w.availableModels?.length != null
                                ? `${w.availableModels.length}`
                                : (w.modelCatalogState ?? '—')}
                            </span>
                          </div>
                        </div>

                        {/* Capability card */}
                        <div className="worker-detail-card">
                          <h4 className="worker-detail-card-title">
                            {t('workers.sectionCapability')}
                          </h4>
                          <div className="worker-cap-row">
                            {(
                              [
                                ['capSessionLoad', cs?.sessionLoad],
                                ['capSessionResume', cs?.sessionResume],
                                ['capSessionList', cs?.sessionList],
                                ['capLogout', cs?.authLogout],
                              ] as const
                            ).map(([key, val]) => (
                              <div key={key} className="worker-cap-item">
                                <span className={`worker-cap-check ${val ? 'on' : 'off'}`}>
                                  {val ? '✓' : '✗'}
                                </span>
                                {t(`workers.${key}`)}
                              </div>
                            ))}
                          </div>
                        </div>

                        <WorkerExecutionConfigEditor
                          key={w.id}
                          worker={w}
                          projectId={projectId}
                          onSaved={onRefreshSnapshot}
                          onError={toastError}
                          onSuccess={toastSuccess}
                        />
                      </div>

                      {/* Probe console — action + code-styled log */}
                      <WorkerProbeConsole
                        key={w.id}
                        worker={w}
                        onProbed={() => onRefreshSnapshot?.()}
                      />
                    </div>
                  )
                })()}

              {/* Register new agent */}
              {railFocus?.type === 'register' && (
                <div className="worker-register-panel">
                  <div className="seg-control worker-register-mode-seg" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={regMode === 'auto'}
                      className={regMode === 'auto' ? 'active' : ''}
                      onClick={() => switchRegisterMode('auto')}
                    >
                      {t('workers.registerModeAuto')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={regMode === 'manual'}
                      className={regMode === 'manual' ? 'active' : ''}
                      onClick={() => switchRegisterMode('manual')}
                    >
                      {t('workers.registerModeManual')}
                    </button>
                  </div>
                  <p className="settings-field-hint">
                    {regMode === 'auto'
                      ? t('workers.registryHint')
                      : t('workers.manualRegistrationHint')}
                  </p>
                  {regMode === 'auto' ? (
                    <>
                      <div className="settings-field worker-register-agent-field">
                        <div className="worker-register-field-head">
                          <span className="field-label">{t('workers.registryAgent')}</span>
                          <button
                            type="button"
                            className="worker-register-update-link"
                            disabled={workerRegistryLoading || workerRegistryChecking}
                            onClick={() => void checkRegistryUpdates()}
                          >
                            {workerRegistryChecking
                              ? t('workers.registryCheckingUpdates')
                              : t('workers.registryCheckUpdates')}
                          </button>
                        </div>
                        <WorkerRegistryCombobox
                          options={workerRegistry}
                          selectedId={regSelectedId}
                          loading={workerRegistryLoading}
                          error={workerRegistryError}
                          placeholder={t('workers.registryManifestUnavailable')}
                          loadingLabel={t('app.loading')}
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
                        {workerRegistryCatalog && (
                          <p className="settings-field-hint mono">
                            {workerRegistrySource} · {t('workers.registryUpdatedAt')}:{' '}
                            {workerRegistryFetchedAt} ·{' '}
                            {t('workers.registryAgentCount', {
                              count: workerRegistryAgentCount,
                            })}
                          </p>
                        )}
                      </div>
                      {selectedRegistryOption && (
                        <RegistryAgentDetail
                          option={selectedRegistryOption}
                          distribution={regDistribution}
                          trustNoSha={regTrustNoSha}
                          observedSha256={undefined}
                          onDistributionChange={(d) => setRegDistribution(d)}
                          onTrustNoShaChange={(trusted) => setRegTrustNoSha(trusted)}
                        />
                      )}
                      {selectedRegistryOption && !regManifestDigest && (
                        <p className="settings-error">{t('workers.registryManifestUnavailable')}</p>
                      )}
                      {regPrepareStatus && <p className="settings-muted">{regPrepareStatus}</p>}
                      {pendingRegistryPrepare && (
                        <WorkerPrepareProgress
                          initial={pendingRegistryPrepare.operation}
                          onSucceeded={(result) => finishRegistryRegistration(result)}
                          onFailed={(operation) => {
                            setRegBusy(false)
                            toastError(operation.error ?? t('workers.registryPrepareFailed'))
                          }}
                          onCancel={() => setRegBusy(false)}
                          onRetry={() => {
                            setPendingRegistryPrepare(null)
                            void saveWorker()
                          }}
                        />
                      )}
                      {isRegistryPath && !selectedRegistryOption && (
                        <p className="settings-error">
                          {t('workers.registrySelectionUnavailable')}
                        </p>
                      )}
                      <div className="settings-field">
                        <label htmlFor="worker-reg-name">{t('workers.formName')}</label>
                        <input
                          id="worker-reg-name"
                          className="settings-input ui-font"
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                        />
                      </div>
                      <p className="settings-field-hint">{t('workers.registryOwnerManagedHint')}</p>
                    </>
                  ) : (
                    <>
                      <div className="settings-field">
                        <label htmlFor="worker-reg-name-manual">{t('workers.formName')}</label>
                        <input
                          id="worker-reg-name-manual"
                          className="settings-input ui-font"
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                        />
                      </div>
                      <WorkerIconPicker
                        options={iconPickerOptions}
                        name={regName}
                        command={regCommand}
                        value={regIconAgentId}
                        userPicked={regIconUserPicked}
                        disabled={regBusy}
                        onChange={onManualIconChange}
                      />
                      <div className="settings-field">
                        <label htmlFor="worker-reg-launch">{t('workers.customLaunchKind')}</label>
                        <select
                          id="worker-reg-launch"
                          className="settings-input ui-font"
                          value={regCustomLaunchKind}
                          onChange={(event) =>
                            setRegCustomLaunchKind(event.target.value as CustomAcpLaunchKind)
                          }
                        >
                          <option value="auto">{t('workers.customAutoDetect')}</option>
                          <option value="npx">npx package</option>
                          <option value="uvx">uvx package</option>
                          <option value="system">{t('workers.customSystemExecutable')}</option>
                          <option value="local">{t('workers.customLocalExecutable')}</option>
                        </select>
                      </div>
                      <div className="settings-field">
                        <label htmlFor="worker-reg-command">
                          {regCustomLaunchKind === 'npx' || regCustomLaunchKind === 'uvx'
                            ? t('workers.customPackageSpec')
                            : t('workers.formCommand')}
                        </label>
                        <input
                          id="worker-reg-command"
                          className="settings-input mono"
                          value={regCommand}
                          onChange={(e) => setRegCommand(e.target.value)}
                          placeholder={
                            regCustomLaunchKind === 'npx' || regCustomLaunchKind === 'uvx'
                              ? '@scope/acp-agent@version'
                              : regCustomLaunchKind === 'local'
                                ? '/absolute/path/to/acp-agent'
                                : regCustomLaunchKind === 'system'
                                  ? 'acp-agent'
                                  : t('workers.formCommandAutoPlaceholder')
                          }
                        />
                      </div>
                      <div className="settings-field">
                        <label htmlFor="worker-reg-args">{t('workers.formArgs')}</label>
                        <input
                          id="worker-reg-args"
                          className="settings-input mono"
                          value={regArgs}
                          onChange={(e) => setRegArgs(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  <div className="model-edit-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setRegOpen(false)
                        setRailFocus(null)
                      }}
                    >
                      {t('prompt.cancel')}
                    </button>
                    <button
                      type="button"
                      className="settings-save-btn"
                      disabled={
                        regBusy ||
                        !regName.trim() ||
                        (regMode === 'manual'
                          ? !regCommand.trim()
                          : registrationRoute.kind !== 'registry')
                      }
                      onClick={() => void saveWorker()}
                    >
                      {regBusy && <span className="btn-spinner" aria-hidden />}
                      {regBusy ? t('workers.installing') : t('workers.install')}
                    </button>
                  </div>
                </div>
              )}

              {/* Crew detail */}
              {railFocus?.type === 'crew' &&
                (() => {
                  const tmpl = teamTemplates.find((x) => x.id === railFocus.id)
                  if (!tmpl) return <p className="settings-muted">{t('workers.empty')}</p>
                  return (
                    <TeamTemplateLibrary
                      workers={workers}
                      projectId={projectId}
                      initialTemplates={teamTemplates}
                      focusTemplateId={tmpl.id}
                      onChanged={() => {
                        onRefreshSnapshot?.()
                        // reload templates so the rail stays in sync
                        api
                          .listTeamTemplates()
                          .then(({ templates }) => setTeamTemplates(templates))
                          .catch(() => {})
                      }}
                      layout="settings"
                      hideRail
                    />
                  )
                })()}

              {/* Empty state */}
              {!railFocus && (
                <div className="settings-empty-state">
                  <p className="settings-muted">{t('workers.selectPrompt')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Modals (outside the layout grid) */}
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
          <ConfirmAddCliDialog
            open={!!customPreview}
            preview={customPreview?.preview ?? null}
            onCancel={() => setCustomPreview(null)}
            onConfirm={(decision) => void confirmCustomAcp(decision)}
            onReuse={() => setCustomPreview(null)}
          />
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
          <div className="settings-form-card about-oss-card">
            <OpenSourceCredits />
          </div>
        </div>
      )}
    </div>
  )

  const navIcon = (id: TabId) => {
    if (id === 'general') return <IconSettings size={16} />
    if (id === 'model') return <IconCpu size={16} />
    if (id === 'prompts') return <IconFileEdit size={16} />
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
        {/* Shared confirmation layer: General Danger Zone and Worker actions both use this. */}
        {pendingConfirm && (
          <ConfirmDialog open config={pendingConfirm} onClose={() => setPendingConfirm(null)} />
        )}
      </div>
    </div>
  )
}
