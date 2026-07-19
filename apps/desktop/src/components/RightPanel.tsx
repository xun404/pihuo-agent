import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApprovalDecision,
  ApprovalItem,
  WorkerJob,
  WorkerKind,
  WorkerRegistration,
  WorkerRole,
} from '@router-agents/shared'
import { WORKER_ROLES } from '@router-agents/shared'
import { useI18n } from '../i18n/I18nProvider'
import { roleMessageKey } from '../i18n/locales'
import { api, type FileEntryDto, type GitStatusResponse } from '../lib/api'
import { resolveWorkerModelOptions, shouldApplyScopedModelResponse } from '../lib/worker-model-view'
import { ApprovalActions } from './ApprovalActions'
import { WorkerBrandLogo } from './Icons'
import { useToast } from './Toast'

type Tab = 'workers' | 'git' | 'files' | 'approvals'

function kindClass(kind: WorkerRegistration['kind']): string {
  if (kind === 'claude') return 'claude'
  if (kind === 'codex') return 'codex'
  if (kind === 'opencode') return 'opencode'
  return 'custom'
}

function roleBadgeClass(role: WorkerRole): string {
  switch (role) {
    case 'plan':
      return 'badge-blue'
    case 'coder':
      return 'badge-orange'
    case 'review':
      return 'badge-purple'
    case 'test':
      return 'badge-green'
    case 'research':
      return 'badge-yellow'
    default:
      return 'badge-gray'
  }
}

function statusLetter(status: string): string {
  if (status === '??') return '?'
  return status.replace(/\s/g, '')[0] ?? 'M'
}

function FileTree({ entries, depth = 0 }: { entries: FileEntryDto[]; depth?: number }) {
  return (
    <>
      {entries.map((e) => (
        <div key={e.path}>
          <div
            className={`tree-item w-row inspector-list-row${e.type === 'directory' ? ' folder' : ''}`}
            style={{ paddingLeft: 10 + depth * 12 }}
          >
            <span className="tree-item-ico" aria-hidden>
              {e.type === 'directory' ? '▾' : '·'}
            </span>
            <div className="info">
              <div className="n">{e.name}</div>
            </div>
          </div>
          {e.children && e.children.length > 0 && (
            <FileTree entries={e.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  )
}

interface Props {
  workers: WorkerRegistration[]
  approvals: ApprovalItem[]
  projectId: string | null
  sessionId?: string | null
  onToggle: (id: string, enabled: boolean) => void
  onHealth: (id: string, depth?: 'presence' | 'version' | 'acp') => void | Promise<void>
  onHealthAll?: () => void | Promise<unknown>
  onSetRoles: (id: string, body: { primaryRole: WorkerRole; roles: WorkerRole[] }) => void
  onSetModel?: (id: string, model: string | null, projectId: string | null) => void | Promise<void>
  onFetchModels?: (
    id: string,
    opts?: { q?: string; force?: boolean; limit?: number; projectId?: string | null },
  ) => Promise<{
    ok: boolean
    models: { modelId: string; name: string; description?: string }[]
    error?: string
    errorCode?: string
    stale?: boolean
    catalogState?: 'empty' | 'fresh' | 'stale'
    currentPinState?: {
      modelId: string
      status: 'available' | 'unavailable' | 'unknown'
      reasonCode?: string
    }
  }>
  onResolveApproval: (
    approvalId: string,
    optionId: string | undefined,
    decision: 'allow' | 'deny' | 'cancel',
    surface: 'chat' | 'panel',
  ) => void
  resolving?: Record<string, boolean>
  onRegisterWorker: (body: Partial<WorkerRegistration>) => Promise<void>
  onDetectWorkers?: () => Promise<{
    recommended?: { kind: string; name: string; installed: boolean; installHint?: string }[]
    candidates?: { kind: string; name: string; installed: boolean; installHint?: string }[]
  } | void>
  onRefreshSnapshot: () => void
}

function jobStatusClass(status: string): string {
  if (status === 'running') return 'job-status running'
  if (status === 'pending_approval') return 'job-status pending'
  if (status === 'succeeded') return 'job-status ok'
  if (status === 'failed' || status === 'timed_out') return 'job-status err'
  if (status === 'cancelled') return 'job-status muted'
  return 'job-status'
}

function healthBadgeClass(status: string): string {
  if (status === 'healthy' || status === 'ready') return 'badge-green'
  if (status === 'unhealthy' || status === 'degraded') return 'badge-yellow'
  if (status === 'missing' || status === 'unavailable') return 'badge-orange'
  return 'badge-gray'
}

function healthLabelKey(
  status: string,
):
  | 'workers.health.healthy'
  | 'workers.health.unhealthy'
  | 'workers.health.missing'
  | 'workers.health.unknown' {
  if (status === 'healthy' || status === 'ready') return 'workers.health.healthy'
  if (status === 'unhealthy' || status === 'degraded') return 'workers.health.unhealthy'
  if (status === 'missing' || status === 'unavailable') return 'workers.health.missing'
  return 'workers.health.unknown'
}

function shortHealthLabel(status: string): string {
  return status
}

function relChecked(iso: string | undefined, nowLabel: string): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return nowLabel
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function RightPanel({
  workers,
  approvals,
  projectId,
  sessionId,
  onToggle,
  onHealth,
  onHealthAll,
  onSetRoles,
  onSetModel,
  onFetchModels,
  onResolveApproval,
  resolving = {},
  onRegisterWorker,
  onDetectWorkers,
  onRefreshSnapshot,
}: Props) {
  const { t } = useI18n()
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set())
  const [checkingAll, setCheckingAll] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast()
  const [expandedHealth, setExpandedHealth] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('workers')
  const [jobs, setJobs] = useState<WorkerJob[]>([])
  const [busyWorkerIds, setBusyWorkerIds] = useState<Set<string>>(() => new Set())
  const [jobsLoading, setJobsLoading] = useState(false)
  const [dispatchTask, setDispatchTask] = useState('')
  const [dispatchRole, setDispatchRole] = useState<WorkerRole>('coder')
  const [dispatchBusy, setDispatchBusy] = useState(false)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modelsLoadingIds, setModelsLoadingIds] = useState<Set<string>>(() => new Set())
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({})
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({})
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({})
  const [searchResults, setSearchResults] = useState<
    Record<string, { modelId: string; name: string; description?: string }[]>
  >({})
  const [catalogResults, setCatalogResults] = useState<
    Record<string, { modelId: string; name: string; description?: string }[]>
  >({})
  const [catalogStates, setCatalogStates] = useState<Record<string, 'empty' | 'fresh' | 'stale'>>(
    {},
  )
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /** Monotonic search generation per worker — drop stale responses */
  const searchGen = useRef<Record<string, number>>({})
  const catalogGen = useRef<Record<string, number>>({})
  const modelScopeRef = useRef(projectId)
  modelScopeRef.current = projectId
  /** Pin availability from models API (unavailable pins are not options) */
  const [pinStates, setPinStates] = useState<
    Record<string, { modelId: string; status: string; reasonCode?: string }>
  >({})
  /** Per-worker pin mutation generation — ignore stale success/failure */
  const pinGen = useRef<Record<string, number>>({})
  const pinInFlight = useRef<Record<string, boolean>>({})
  const gitRequestGen = useRef(0)
  const filesRequestGen = useRef(0)
  const jobsRequestGen = useRef(0)
  const dispatchRequestGen = useRef(0)
  const sessionScopeRef = useRef(sessionId)
  sessionScopeRef.current = sessionId

  const [git, setGit] = useState<GitStatusResponse | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<string | null>(null)

  const [files, setFiles] = useState<FileEntryDto[] | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [filesTruncated, setFilesTruncated] = useState(false)

  const [regName, setRegName] = useState('')
  const [regCommand, setRegCommand] = useState('')
  const [regArgs, setRegArgs] = useState('')
  const [regRole, setRegRole] = useState<WorkerRole>('general')
  const [regBusy, setRegBusy] = useState(false)

  const loadGit = useCallback(async () => {
    const gen = ++gitRequestGen.current
    const requestProjectId = projectId
    if (!projectId) {
      setGit(null)
      setGitError(t('git.noProject'))
      setGitLoading(false)
      return
    }
    setGitLoading(true)
    setGitError(null)
    try {
      const data = await api.gitStatus(projectId)
      if (gen !== gitRequestGen.current || modelScopeRef.current !== requestProjectId) return
      setGit(data)
      if (!data.ok) setGitError(data.error ?? t('git.error'))
    } catch (e) {
      if (gen !== gitRequestGen.current || modelScopeRef.current !== requestProjectId) return
      setGit(null)
      setGitError(e instanceof Error ? e.message : String(e))
    } finally {
      if (gen === gitRequestGen.current && modelScopeRef.current === requestProjectId) {
        setGitLoading(false)
      }
    }
  }, [projectId, t])

  const loadFiles = useCallback(async () => {
    const gen = ++filesRequestGen.current
    const requestProjectId = projectId
    if (!projectId) {
      setFiles(null)
      setFilesError(t('files.noProject'))
      setFilesLoading(false)
      return
    }
    setFilesLoading(true)
    setFilesError(null)
    try {
      const data = await api.listFiles(projectId)
      if (gen !== filesRequestGen.current || modelScopeRef.current !== requestProjectId) return
      if (!data.ok) {
        setFiles(null)
        setFilesError(data.error ?? t('files.error'))
      } else {
        setFiles(data.entries)
        setFilesTruncated(data.truncated)
      }
    } catch (e) {
      if (gen !== filesRequestGen.current || modelScopeRef.current !== requestProjectId) return
      setFiles(null)
      setFilesError(e instanceof Error ? e.message : String(e))
    } finally {
      if (gen === filesRequestGen.current && modelScopeRef.current === requestProjectId) {
        setFilesLoading(false)
      }
    }
  }, [projectId, t])

  const loadJobs = useCallback(async () => {
    const gen = ++jobsRequestGen.current
    const requestSessionId = sessionId
    setJobsLoading(true)
    try {
      const data = await api.listJobs({
        sessionId: sessionId ?? undefined,
        limit: 40,
      })
      if (gen !== jobsRequestGen.current || sessionScopeRef.current !== requestSessionId) return
      setJobs(data.jobs ?? [])
      setBusyWorkerIds(new Set(data.busyWorkerIds ?? []))
    } catch {
      /* ignore */
    } finally {
      if (gen === jobsRequestGen.current && sessionScopeRef.current === requestSessionId) {
        setJobsLoading(false)
      }
    }
  }, [sessionId])

  useEffect(() => {
    gitRequestGen.current += 1
    filesRequestGen.current += 1
    setGit(null)
    setGitError(null)
    setGitLoading(false)
    setFiles(null)
    setFilesError(null)
    setFilesLoading(false)
    setFilesTruncated(false)
  }, [projectId])

  useEffect(() => {
    jobsRequestGen.current += 1
    dispatchRequestGen.current += 1
    setJobs([])
    setBusyWorkerIds(new Set())
    setJobsLoading(false)
    setDispatchBusy(false)
  }, [sessionId])

  useEffect(() => {
    if (tab === 'git') void loadGit()
    if (tab === 'files') void loadFiles()
  }, [tab, loadGit, loadFiles])

  // Clear model-search debounce timers on unmount
  useEffect(() => {
    return () => {
      for (const t of Object.values(searchTimers.current)) {
        clearTimeout(t)
      }
      searchTimers.current = {}
    }
  }, [])

  // Catalogs are cwd-scoped. Invalidate every transient view/request boundary when
  // the active project changes so project A can never populate project B's controls.
  useEffect(() => {
    for (const timer of Object.values(searchTimers.current)) clearTimeout(timer)
    searchTimers.current = {}
    for (const workerId of Object.keys(searchGen.current)) searchGen.current[workerId]! += 1
    for (const workerId of Object.keys(catalogGen.current)) catalogGen.current[workerId]! += 1
    for (const workerId of Object.keys(pinGen.current)) pinGen.current[workerId]! += 1
    pinInFlight.current = {}
    setModelsLoadingIds(new Set())
    setModelDrafts({})
    setModelSearch({})
    setSearchResults({})
    setCatalogResults({})
    setCatalogStates({})
    setPinStates({})
    setModelErrors({})
  }, [projectId])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'workers', label: t('right.workers') },
    { id: 'git', label: t('right.git') },
    { id: 'files', label: t('right.files') },
    { id: 'approvals', label: t('right.approvals') },
  ]

  const cyclePrimary = (w: WorkerRegistration) => {
    const list = w.roles.length ? w.roles : ([...WORKER_ROLES] as WorkerRole[])
    const idx = list.indexOf(w.primaryRole)
    const next = list[(idx + 1) % list.length]!
    onSetRoles(w.id, { primaryRole: next, roles: list })
  }

  const toggleRole = (w: WorkerRegistration, role: WorkerRole) => {
    const has = w.roles.includes(role)
    let roles = has ? w.roles.filter((r) => r !== role) : [...w.roles, role]
    if (roles.length === 0) roles = [w.primaryRole]
    let primaryRole = w.primaryRole
    if (!roles.includes(primaryRole)) primaryRole = roles[0]!
    onSetRoles(w.id, { primaryRole, roles })
  }

  const submitWorker = async () => {
    if (!regName.trim() || !regCommand.trim()) return
    setRegBusy(true)
    try {
      const args = regArgs.trim().split(/\s+/).filter(Boolean)
      await onRegisterWorker({
        name: regName.trim(),
        command: regCommand.trim(),
        args,
        kind: 'custom' as WorkerKind,
        primaryRole: regRole,
        roles: [regRole, 'general'],
        capabilities: ['general'],
        description: `Custom worker: ${regName.trim()}`,
        enabled: true,
      })
      setRegName('')
      setRegCommand('')
      setRegArgs('')
      setShowForm(false)
      onRefreshSnapshot()
    } finally {
      setRegBusy(false)
    }
  }

  return (
    <aside className="panel panel-right inspector-panel">
      <div className="drawer-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'on' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'workers' && (
        <div className="drawer-body tab-panel active">
          {/* 线稿：section-hint + w-row 列表；运维动作收在底部 */}
          <div className="section-hint">{t('right.workersHint')}</div>
          {workers.map((w) => {
            const checking = checkingIds.has(w.id)
            const report = w.healthReport
            const healthKey =
              w.health === 'healthy'
                ? ('workers.health.healthy' as const)
                : w.health === 'missing'
                  ? ('workers.health.missing' as const)
                  : w.health === 'unhealthy'
                    ? ('workers.health.unhealthy' as const)
                    : ('workers.health.unknown' as const)
            const roleLabel =
              w.primaryRole === 'coder'
                ? 'coder'
                : w.primaryRole === 'review'
                  ? 'review'
                  : w.primaryRole === 'plan'
                    ? 'plan'
                    : w.primaryRole === 'test'
                      ? 'test'
                      : w.primaryRole === 'research'
                        ? 'research'
                        : 'general'
            const healthEn =
              w.health === 'healthy'
                ? 'healthy'
                : w.health === 'missing'
                  ? 'missing'
                  : w.health === 'unhealthy'
                    ? 'unhealthy'
                    : 'unknown'
            return (
              <div className="w-row inspector-worker-row" key={w.id}>
                <span className={`worker-logo ${kindClass(w.kind)}`} title={w.name} aria-hidden>
                  <WorkerBrandLogo kind={w.kind} name={w.name} size={14} />
                </span>
                <div className="info">
                  <div className="n">
                    {w.name}
                    {busyWorkerIds.has(w.id) && (
                      <span
                        className="badge badge-green worker-busy-badge"
                        title={t('workers.busy')}
                      >
                        {t('workers.busy')}
                      </span>
                    )}
                  </div>
                  {/* 线稿副行：role · health */}
                  <div className="s">
                    <span>{roleLabel}</span>
                    <span aria-hidden> · </span>
                    <button
                      type="button"
                      className={`health-inline${checking ? ' checking' : ''}`}
                      title={report?.message ?? t('workers.healthHint')}
                      onClick={() => {
                        if (checking) return
                        setCheckingIds((s) => new Set(s).add(w.id))
                        void Promise.resolve(onHealth(w.id, 'version')).finally(() => {
                          setCheckingIds((s) => {
                            const n = new Set(s)
                            n.delete(w.id)
                            return n
                          })
                        })
                      }}
                    >
                      {checking ? '…' : healthEn}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className={`toggle${w.enabled ? '' : ' off'}`}
                  role="switch"
                  aria-checked={w.enabled}
                  aria-label={t('workers.formEnabled')}
                  onClick={() => onToggle(w.id, !w.enabled)}
                />
              </div>
            )
          })}
          {workers.length === 0 && <p className="section-hint">{t('workers.detectFirstRun')}</p>}
          <div className="inspector-actions">
            <button
              className="settings-btn-soft"
              type="button"
              disabled={detecting || !onDetectWorkers}
              title={t('workers.detectHint')}
              onClick={() => {
                if (!onDetectWorkers) return
                setDetecting(true)
                void Promise.resolve(onDetectWorkers())
                  .then((res) => {
                    const rec =
                      res?.recommended ?? res?.candidates?.filter((c) => c.installed) ?? []
                    if (rec.length === 0) toastInfo(t('workers.detectNone'))
                    else
                      toastSuccess(
                        t('workers.detectOk', {
                          names: rec.map((c) => c.name).join(' · '),
                        }),
                      )
                  })
                  .catch((e) => toastError(String(e)))
                  .finally(() => setDetecting(false))
              }}
            >
              {detecting ? t('app.loading') : t('workers.detect')}
            </button>
            <button
              className="settings-btn-soft"
              type="button"
              disabled={checkingAll}
              title={t('workers.healthAllHint')}
              onClick={() => {
                if (!onHealthAll) return
                setCheckingAll(true)
                void Promise.resolve(onHealthAll()).finally(() => setCheckingAll(false))
              }}
            >
              {checkingAll ? t('app.loading') : t('workers.healthAll')}
            </button>
            <button
              className="settings-btn-soft"
              type="button"
              onClick={() => setShowForm((v) => !v)}
            >
              {t('workers.register')}
            </button>
          </div>
          {showForm && (
            <div className="settings-form-card worker-register-card" style={{ maxWidth: '100%' }}>
              <div className="model-list-label">{t('workers.registerTitle')}</div>
              <div className="settings-field">
                <label>{t('workers.formName')}</label>
                <input
                  className="settings-input"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
              </div>
              <div className="settings-field">
                <label>{t('workers.formCommand')}</label>
                <input
                  className="settings-input mono"
                  value={regCommand}
                  onChange={(e) => setRegCommand(e.target.value)}
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
              <div className="settings-field">
                <label>{t('workers.primary')}</label>
                <select
                  className="field-select"
                  value={regRole}
                  onChange={(e) => setRegRole(e.target.value as WorkerRole)}
                >
                  {WORKER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(roleMessageKey(r))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="model-edit-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>
                  {t('workers.cancel')}
                </button>
                <button
                  type="button"
                  className="settings-save-btn"
                  disabled={regBusy || !regName.trim() || !regCommand.trim()}
                  onClick={() => void submitWorker()}
                >
                  {regBusy ? t('app.loading') : t('workers.formSave')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'git' && (
        <div className="drawer-body tab-panel active">
          <div className="inspector-panel-head">
            <div className="inspector-panel-title">
              {git?.branch ? `⎇ ${git.branch}` : t('right.git')}
            </div>
            <button
              className="settings-btn-soft"
              type="button"
              onClick={() => void loadGit()}
              disabled={gitLoading}
            >
              {gitLoading ? t('app.loading') : t('common.refresh')}
            </button>
          </div>
          <div className="inspector-stats">
            <div className="inspector-stat">
              <div className="inspector-stat-n is-green">
                {gitLoading ? '…' : git ? `+${git.insertions}` : '—'}
              </div>
              <div className="inspector-stat-l">{t('git.insertions')}</div>
            </div>
            <div className="inspector-stat">
              <div className="inspector-stat-n is-danger">
                {gitLoading ? '…' : git ? `−${git.deletions}` : '—'}
              </div>
              <div className="inspector-stat-l">{t('git.deletions')}</div>
            </div>
          </div>
          {gitError && <p className="section-hint is-warn">{gitError}</p>}
          {!gitError && git && git.files.length === 0 && (
            <p className="section-hint">{t('git.clean')}</p>
          )}
          {git?.files.map((f) => (
            <div className="w-row inspector-list-row" key={f.path}>
              <span className={`git-status-badge ${statusLetter(f.status)}`}>
                {statusLetter(f.status)}
              </span>
              <div className="info">
                <div className="n mono">{f.path}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'files' && (
        <div className="drawer-body tab-panel active">
          <div className="inspector-panel-head">
            <div className="inspector-panel-title">{t('right.files')}</div>
            <button
              className="settings-btn-soft"
              type="button"
              onClick={() => void loadFiles()}
              disabled={filesLoading}
            >
              {filesLoading ? t('app.loading') : t('common.refresh')}
            </button>
          </div>
          {filesLoading && <p className="section-hint">{t('app.loading')}</p>}
          {filesError && <p className="section-hint is-warn">{filesError}</p>}
          {!filesLoading && !filesError && files && files.length === 0 && (
            <p className="section-hint">{t('files.empty')}</p>
          )}
          {files && <FileTree entries={files} />}
          {filesTruncated && <p className="section-hint">{t('files.truncated')}</p>}
        </div>
      )}

      {tab === 'approvals' && (
        <div className="drawer-body tab-panel active">
          <div className="inspector-panel-head">
            <div className="inspector-panel-title">
              {t('approvals.pending')} ({approvals.filter((a) => a.status === 'pending').length})
            </div>
            <button className="settings-btn-soft" type="button" onClick={() => onRefreshSnapshot()}>
              {t('common.refresh')}
            </button>
          </div>
          {approvals.filter((a) => a.status === 'pending').length === 0 && (
            <p className="section-hint">{t('approvals.empty')}</p>
          )}
          {approvals
            .filter((a) => a.status === 'pending')
            .map((a) => (
              <div className="inspector-approval-card" key={a.id}>
                <div className="inspector-approval-title">{a.title}</div>
                {a.workerName && (
                  <div className="inspector-approval-meta">
                    {t('approvals.worker')}: {a.workerName}
                  </div>
                )}
                {a.pathOrTarget && (
                  <div className="inspector-approval-meta mono">
                    {t('approvals.target')}: {a.pathOrTarget}
                  </div>
                )}
                <div className="approval-row inspector-approval-actions">
                  <ApprovalActions
                    approval={a}
                    surface="panel"
                    resolving={resolving}
                    onResolve={onResolveApproval}
                    variant="wireframe"
                  />
                </div>
              </div>
            ))}
        </div>
      )}
    </aside>
  )
}
