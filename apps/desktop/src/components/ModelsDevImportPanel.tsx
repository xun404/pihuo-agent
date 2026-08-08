/**
 * models.dev add-provider list — isolated state so search typing does not
 * re-render the entire SettingsPanel (~180 ProviderLogo rows).
 */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { ProviderLogo } from '../lib/provider-icons'
import type { MessageKey } from '../i18n/locales'
import type { ConfirmDialogConfig } from './ui/ConfirmDialog'

type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string

export type ModelsDevProviderRow = {
  id: string
  name: string
  modelCount: number
  npm?: string
  api?: string
  needsBaseURL: boolean
  alreadyAdded?: boolean
}

function filterProviders(list: ModelsDevProviderRow[], query: string): ModelsDevProviderRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.api ?? '').toLowerCase().includes(q),
  )
}

const ModelsDevRow = memo(function ModelsDevRow({
  p,
  saving,
  importing,
  addLabel,
  addedLabel,
  loadingLabel,
  modelCountLabel,
  onImport,
}: {
  p: ModelsDevProviderRow
  saving: boolean
  importing: boolean
  addLabel: string
  addedLabel: string
  loadingLabel: string
  modelCountLabel: string
  onImport: (id: string) => void
}) {
  const already = Boolean(p.alreadyAdded)
  return (
    <div
      className={`models-dev-row${already ? ' is-added' : ''}`}
      role="option"
      aria-disabled={already || undefined}
    >
      <span className="logo models-dev-row-logo" aria-hidden>
        <ProviderLogo providerId={p.id} size={16} />
      </span>
      <span className="models-dev-row-text">
        <span className="models-dev-row-name">{p.name}</span>
        <span className="models-dev-row-meta">
          {p.id} · {modelCountLabel}
          {p.needsBaseURL && p.api ? ` · ${p.api}` : ''}
        </span>
      </span>
      <button
        type="button"
        className={`settings-save-btn btn-sm${already ? ' is-added' : ''}`}
        disabled={already || saving || importing}
        onClick={() => {
          if (!already) onImport(p.id)
        }}
      >
        {already ? addedLabel : importing ? loadingLabel : addLabel}
      </button>
    </div>
  )
})

export function ModelsDevImportPanel({
  active,
  saving,
  t,
  toastInfo,
  toastSuccess,
  toastError,
  onRequestConfirm,
  onImported,
}: {
  active: boolean
  saving: boolean
  t: TFunc
  toastInfo: (msg: string) => void
  toastSuccess: (msg: string) => void
  toastError: (msg: string) => void
  onRequestConfirm: (config: ConfirmDialogConfig) => void
  onImported: (providerId: string) => void | Promise<void>
}) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [list, setList] = useState<ModelsDevProviderRow[]>([])
  const [meta, setMeta] = useState<{ fetchedAt: string; providerCount: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)

  // Tab switching / navigation unmounts this panel while refresh is in flight;
  // guard every async continuation so a late failure can neither setState on an
  // unmounted component nor pop a confirm dialog the user never asked for.
  // Reset on every effect setup so Vite HMR (which runs cleanup without a full
  // remount) never leaves the guard stuck at false.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const filtered = useMemo(() => filterProviders(list, deferredQuery), [list, deferredQuery])

  const applyList = useCallback(async () => {
    // Always load full catalog; filter is client-side for snappy search.
    // 10s cap: while a refresh request is in flight the browser may reuse the
    // busy socket and stall this GET far beyond its normal ~50ms.
    const res = await api.listModelsDevProviders('', undefined, 10_000)
    if (!mountedRef.current) return res
    setList(res.providers)
    setMeta(
      res.meta ? { fetchedAt: res.meta.fetchedAt, providerCount: res.meta.providerCount } : null,
    )
    return res
  }, [])

  const offerNpmSnapshot = useCallback(() => {
    // Never propose a blocking confirm dialog after the panel was unmounted
    // (user switched tabs/closed settings while the refresh was failing).
    if (!mountedRef.current) return
    onRequestConfirm({
      title: t('settings.modelsDevNpmSnapshotTitle'),
      message: t('settings.modelsDevNpmSnapshotMessage'),
      confirmLabel: t('settings.modelsDevNpmSnapshotConfirm'),
      busyLabel: t('settings.modelsDevNpmSnapshotBusy'),
      cancelLabel: t('common.cancel'),
      onConfirm: async () => {
        setLoading(true)
        setError(null)
        try {
          const result = await api.refreshModelsDevCatalog({ source: 'npm-snapshot' })
          await applyList()
          if (!mountedRef.current) return
          const ver = result.packageVersion ? `@${result.packageVersion}` : ''
          toastInfo(
            t('settings.modelsDevNpmSnapshotDone', {
              version: ver,
              count: String(result.providerCount),
            }),
          )
        } catch (e) {
          if (!mountedRef.current) return
          const msg = e instanceof Error ? e.message : String(e)
          setError(t('settings.modelsDevNpmSnapshotFailed', { error: msg }))
          throw e
        } finally {
          if (mountedRef.current) setLoading(false)
        }
      },
    })
  }, [applyList, onRequestConfirm, t, toastInfo])

  const loadList = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      if (!mountedRef.current) return
      setLoading(true)
      setError(null)
      try {
        if (opts?.forceRefresh) {
          try {
            await api.refreshModelsDevCatalog()
          } catch (e) {
            if (!mountedRef.current) return
            const msg = e instanceof Error ? e.message : String(e)
            const suggest =
              (e as Error & { npmSnapshotSuggested?: boolean; code?: string })
                .npmSnapshotSuggested === true ||
              (e as Error & { code?: string }).code === 'MODELS_DEV_REFRESH_FAILED'
            try {
              const existing = await applyList()
              if (!mountedRef.current) return
              if (existing.catalogAvailable) {
                setError(t('settings.modelsDevRefreshFailedKeepLkg', { error: msg }))
              } else {
                setList([])
                setMeta(null)
                setError(t('settings.modelsDevRefreshFailed', { error: msg }))
              }
            } catch {
              if (!mountedRef.current) return
              setList([])
              setMeta(null)
              setError(t('settings.modelsDevRefreshFailed', { error: msg }))
            }
            if (suggest && mountedRef.current) offerNpmSnapshot()
            return
          }
        }

        if (!mountedRef.current) return
        let res = await api.listModelsDevProviders('', undefined, 10_000)
        if (!res.catalogAvailable && !opts?.forceRefresh) {
          try {
            await api.refreshModelsDevCatalog()
            if (!mountedRef.current) return
            res = await api.listModelsDevProviders('')
          } catch (e) {
            if (!mountedRef.current) return
            const msg = e instanceof Error ? e.message : String(e)
            const suggest =
              (e as Error & { npmSnapshotSuggested?: boolean; code?: string })
                .npmSnapshotSuggested === true ||
              (e as Error & { code?: string }).code === 'MODELS_DEV_REFRESH_FAILED'
            setList([])
            setMeta(null)
            setError(t('settings.modelsDevRefreshFailed', { error: msg }))
            if (suggest && mountedRef.current) offerNpmSnapshot()
            return
          }
        }
        if (!mountedRef.current) return
        setList(res.providers)
        setMeta(
          res.meta ? { fetchedAt: res.meta.fetchedAt, providerCount: res.meta.providerCount } : null,
        )
      } catch (e) {
        if (!mountedRef.current) return
        // 10s list timeout (likely a refresh occupying the connection): show a
        // friendly hint instead of a raw timeout error and stop the spinner.
        const isTimeout =
          e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
        setError(
          isTimeout ? t('settings.modelsDevListTimeout') : (e instanceof Error ? e.message : String(e)),
        )
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [offerNpmSnapshot, t, applyList],
  )

  useEffect(() => {
    if (!active) return
    void loadList()
  }, [active, loadList])

  const onImport = useCallback(
    async (providerId: string) => {
      if (!mountedRef.current) return
      setImportingId(providerId)
      setError(null)
      try {
        const res = await api.importModelsDevProvider(providerId)
        if (!mountedRef.current) return
        toastSuccess(t('settings.modelsDevImported', { name: res.provider.name }))
        // Mark as added in-place so the row stays visible with a disabled button.
        setList((prev) =>
          prev.map((p) => (p.id === providerId ? { ...p, alreadyAdded: true } : p)),
        )
        await onImported(res.provider.id)
      } catch (e) {
        if (!mountedRef.current) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        toastError(msg)
      } finally {
        if (mountedRef.current) setImportingId(null)
      }
    },
    [onImported, t, toastError, toastSuccess],
  )

  const addLabel = t('settings.modelsDevAdd')
  const addedLabel = t('settings.modelsDevAlreadyAdded')
  const loadingLabel = t('app.loading')

  return (
    <div className="models-dev-import">
      <p className="settings-field-hint models-dev-hint">
        <span>{t('settings.modelsDevHint')}</span>{' '}
        <button
          type="button"
          className="settings-link-inline"
          disabled={loading}
          onClick={() => void loadList({ forceRefresh: true })}
        >
          {loading ? t('app.loading') : t('settings.modelsDevRefresh')}
        </button>
      </p>
      <div className="models-dev-toolbar">
        <input
          className="settings-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settings.modelsDevSearchPh')}
          aria-label={t('settings.modelsDevSearchPh')}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {meta && (
        <p className="settings-muted models-dev-meta">
          {t('settings.modelsDevMeta', {
            count: String(meta.providerCount),
            at: new Date(meta.fetchedAt).toLocaleString(),
          })}
          {deferredQuery.trim()
            ? ` · ${t('settings.modelsDevFilterCount', { n: String(filtered.length) })}`
            : null}
        </p>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <div className="models-dev-list" role="listbox" aria-label={t('settings.addFromModelsDev')}>
        {filtered.map((p) => (
          <ModelsDevRow
            key={p.id}
            p={p}
            saving={saving}
            importing={importingId === p.id}
            addLabel={addLabel}
            addedLabel={addedLabel}
            loadingLabel={loadingLabel}
            modelCountLabel={t('settings.modelsDevModelCount', { n: String(p.modelCount) })}
            onImport={onImport}
          />
        ))}
        {!loading && filtered.length === 0 && !error && (
          <p className="settings-muted">{t('settings.modelsDevEmpty')}</p>
        )}
      </div>
    </div>
  )
}
