import { useCallback, useEffect, useState } from 'react'
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

type Tab = 'workers' | 'jobs' | 'git' | 'files' | 'approvals' | 'activity' | 'goals'

function kindClass(kind: WorkerRegistration['kind']): string {
  if (kind === 'claude') return 'claude'
  if (kind === 'codex') return 'codex'
  if (kind === 'opencode') return 'opencode'
  return 'custom'
}

function kindShort(kind: WorkerRegistration['kind']): string {
  if (kind === 'claude') return 'CC'
  if (kind === 'codex') return 'CX'
  if (kind === 'opencode') return 'OC'
  return 'CU'
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
            className={`tree-item${e.type === 'directory' ? ' folder' : ''}`}
            style={{ paddingLeft: 10 + depth * 12 }}
          >
            {e.type === 'directory' ? '▾ ' : '· '}
            {e.name}
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
  memoryThreadId?: string | null
  onToggle: (id: string, enabled: boolean) => void
  onHealth: (id: string, depth?: 'presence' | 'version' | 'acp') => void | Promise<void>
  onHealthAll?: () => void | Promise<unknown>
  onSetRoles: (id: string, body: { primaryRole: WorkerRole; roles: WorkerRole[] }) => void
  onSetModel?: (id: string, model: string | null) => void | Promise<void>
  onFetchModels?: (id: string) => Promise<{
    ok: boolean
    models: { modelId: string; name: string; description?: string }[]
    error?: string
  }>
  onResolveApproval: (id: string, decision: ApprovalDecision) => void
  onDemoApproval: () => void
  onRegisterWorker: (body: Partial<WorkerRegistration>) => Promise<void>
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
  if (status === 'healthy') return 'badge-green'
  if (status === 'unhealthy') return 'badge-yellow'
  if (status === 'missing') return 'badge-orange'
  return 'badge-gray'
}

function healthLabelKey(
  status: string,
): 'workers.health.healthy' | 'workers.health.unhealthy' | 'workers.health.missing' | 'workers.health.unknown' {
  if (status === 'healthy') return 'workers.health.healthy'
  if (status === 'unhealthy') return 'workers.health.unhealthy'
  if (status === 'missing') return 'workers.health.missing'
  return 'workers.health.unknown'
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
  memoryThreadId,
  onToggle,
  onHealth,
  onHealthAll,
  onSetRoles,
  onSetModel,
  onFetchModels,
  onResolveApproval,
  onDemoApproval,
  onRegisterWorker,
  onRefreshSnapshot,
}: Props) {
  const { t } = useI18n()
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set())
  const [checkingAll, setCheckingAll] = useState(false)
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
  const [modelsLoadingId, setModelsLoadingId] = useState<string | null>(null)
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({})
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({})

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

  const [goalText, setGoalText] = useState('')
  const [goalStatus, setGoalStatus] = useState<{
    objective: string | null
    status?: string
    threadId: string | null
    error?: string
  }>({ objective: null, threadId: null })
  const [goalBusy, setGoalBusy] = useState(false)
  const [memoryInfo, setMemoryInfo] = useState<string | null>(null)
  const [controllerInfo, setControllerInfo] = useState<string | null>(null)

  const loadGit = useCallback(async () => {
    if (!projectId) {
      setGit(null)
      setGitError(t('git.noProject'))
      return
    }
    setGitLoading(true)
    setGitError(null)
    try {
      const data = await api.gitStatus(projectId)
      setGit(data)
      if (!data.ok) setGitError(data.error ?? t('git.error'))
    } catch (e) {
      setGit(null)
      setGitError(e instanceof Error ? e.message : String(e))
    } finally {
      setGitLoading(false)
    }
  }, [projectId, t])

  const loadFiles = useCallback(async () => {
    if (!projectId) {
      setFiles(null)
      setFilesError(t('files.noProject'))
      return
    }
    setFilesLoading(true)
    setFilesError(null)
    try {
      const data = await api.listFiles(projectId)
      if (!data.ok) {
        setFiles(null)
        setFilesError(data.error ?? t('files.error'))
      } else {
        setFiles(data.entries)
        setFilesTruncated(data.truncated)
      }
    } catch (e) {
      setFiles(null)
      setFilesError(e instanceof Error ? e.message : String(e))
    } finally {
      setFilesLoading(false)
    }
  }, [projectId, t])

  const loadGoal = useCallback(async () => {
    try {
      const data = await api.getGoal(memoryThreadId ?? undefined)
      const obj = data.objective as
        | { objective?: string; status?: string; text?: string }
        | null
        | string
      let text: string | null = null
      let status: string | undefined
      if (typeof obj === 'string') text = obj
      else if (obj && typeof obj === 'object') {
        text = obj.objective ?? obj.text ?? JSON.stringify(obj)
        status = obj.status
      }
      setGoalStatus({
        objective: text,
        status,
        threadId: data.threadId,
        error: data.error,
      })
      if (text) setGoalText(text)
    } catch (e) {
      setGoalStatus({
        objective: null,
        threadId: memoryThreadId ?? null,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }, [memoryThreadId])

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    try {
      const data = await api.listJobs({
        sessionId: sessionId ?? undefined,
        limit: 40,
      })
      setJobs(data.jobs ?? [])
      setBusyWorkerIds(new Set(data.busyWorkerIds ?? []))
    } catch {
      /* ignore */
    } finally {
      setJobsLoading(false)
    }
  }, [sessionId])

  const loadMemoryAndController = useCallback(async () => {
    try {
      const [mem, ctrl] = await Promise.all([api.memoryStatus(), api.controllerStatus()])
      setMemoryInfo(
        `lastMessages=${mem.lastMessages} · workingMemory=${mem.workingMemory} · OM=${mem.observationalMemory}`,
      )
      setControllerInfo(
        `${ctrl.id} · modes: ${ctrl.modes.map((m) => m.id).join(', ')}`,
      )
    } catch {
      setMemoryInfo(null)
      setControllerInfo(null)
    }
  }, [])

  useEffect(() => {
    if (tab === 'git') void loadGit()
    if (tab === 'files') void loadFiles()
    if (tab === 'jobs') void loadJobs()
    if (tab === 'goals') {
      void loadGoal()
      void loadMemoryAndController()
    }
  }, [tab, loadGit, loadFiles, loadJobs, loadGoal, loadMemoryAndController])

  // Poll jobs while tab open and any open job
  useEffect(() => {
    if (tab !== 'jobs') return
    const hasOpen = jobs.some(
      (j) => j.status === 'queued' || j.status === 'running' || j.status === 'pending_approval',
    )
    if (!hasOpen) return
    const id = setInterval(() => void loadJobs(), 2500)
    return () => clearInterval(id)
  }, [tab, jobs, loadJobs])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'workers', label: t('right.workers') },
    { id: 'jobs', label: t('right.jobs') },
    { id: 'git', label: t('right.git') },
    { id: 'files', label: t('right.files') },
    { id: 'approvals', label: t('right.approvals') },
    { id: 'goals', label: t('right.goals') },
    { id: 'activity', label: t('right.activity') },
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
      const args = regArgs
        .trim()
        .split(/\s+/)
        .filter(Boolean)
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
    <aside className="panel panel-right">
      <div className="tabs">
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

      {tab === 'workers' && (
        <div className="tab-panel active">
          <div className="panel-header" style={{ height: 36 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('workers.registered')}
            </span>
            <div className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
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
              className="btn btn-soft btn-sm"
              type="button"
              onClick={() => setShowForm((v) => !v)}
            >
              {t('workers.register')}
            </button>
          </div>
          <div className="scroll">
            {workers.map((w) => {
              const checking = checkingIds.has(w.id)
              const report = w.healthReport
              const ago = relChecked(report?.checkedAt ?? w.lastSeenAt, t('sidebar.now'))
              const open = expandedHealth === w.id
              return (
              <div className="worker" key={w.id}>
                <div className={`worker-icon ${kindClass(w.kind)}`}>{kindShort(w.kind)}</div>
                <div className="worker-body">
                  <div className="worker-name">
                    {w.name}
                    {busyWorkerIds.has(w.id) && (
                      <span className="badge badge-green worker-busy-badge" title={t('workers.busy')}>
                        {t('workers.busy')}
                      </span>
                    )}
                    <span
                      className={`badge ${healthBadgeClass(w.health)}${checking ? ' worker-health-checking' : ''}`}
                      style={{ cursor: checking ? 'wait' : 'pointer' }}
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
                      {checking ? '…' : t(healthLabelKey(w.health))}
                    </span>
                    {ago && (
                      <span className="worker-health-ago" title={report?.checkedAt}>
                        {ago}
                      </span>
                    )}
                    <button
                      type="button"
                      className="worker-health-detail-btn"
                      title={t('workers.healthDetail')}
                      onClick={() => setExpandedHealth(open ? null : w.id)}
                    >
                      {open ? '▴' : '▾'}
                    </button>
                  </div>
                  {open && (
                    <div className="worker-health-detail">
                      {report?.message && <div>{report.message}</div>}
                      {report?.version && (
                        <div className="mono worker-health-ver">{report.version}</div>
                      )}
                      {report?.hints && report.hints.length > 0 && (
                        <ul>
                          {report.hints.map((h) => (
                            <li key={h}>{h}</li>
                          ))}
                        </ul>
                      )}
                      {!report?.message && !report?.hints?.length && (
                        <div className="settings-muted">{t('workers.healthNoDetail')}</div>
                      )}
                      <div className="worker-health-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={checking}
                          onClick={() => {
                            setCheckingIds((s) => new Set(s).add(w.id))
                            void Promise.resolve(onHealth(w.id, 'acp')).finally(() => {
                              setCheckingIds((s) => {
                                const n = new Set(s)
                                n.delete(w.id)
                                return n
                              })
                            })
                          }}
                        >
                          {t('workers.healthDeep')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="worker-cmd">
                    {w.command} {w.args.join(' ')}
                  </div>
                  <div className="worker-model-row">
                    <label className="worker-model-label">{t('workers.model')}</label>
                    <select
                      className={`worker-model-select${modelsLoadingId === w.id ? ' loading' : ''}`}
                      disabled={modelsLoadingId === w.id}
                      title={t('workers.modelComboHint')}
                      value={
                        modelsLoadingId === w.id
                          ? '__loading__'
                          : (modelDrafts[w.id] ?? w.model ?? '')
                      }
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === '__loading__') return
                        if (v === '__refresh__') {
                          if (!onFetchModels) return
                          setModelsLoadingId(w.id)
                          setModelErrors((m) => {
                            const n = { ...m }
                            delete n[w.id]
                            return n
                          })
                          void onFetchModels(w.id)
                            .then((res) => {
                              if (!res.ok && res.error) {
                                setModelErrors((m) => ({ ...m, [w.id]: res.error! }))
                              } else {
                                setModelErrors((m) => {
                                  const n = { ...m }
                                  delete n[w.id]
                                  return n
                                })
                              }
                            })
                            .catch((err) =>
                              setModelErrors((m) => ({
                                ...m,
                                [w.id]: err instanceof Error ? err.message : String(err),
                              })),
                            )
                            .finally(() => setModelsLoadingId(null))
                          return
                        }
                        if (v === '__manual__') {
                          const typed = window.prompt(
                            t('workers.modelPlaceholder'),
                            w.model ?? '',
                          )
                          if (typed == null) return
                          const id = typed.trim()
                          setModelDrafts((d) => ({ ...d, [w.id]: id }))
                          void Promise.resolve(onSetModel?.(w.id, id || null)).catch((err) =>
                            setModelErrors((m) => ({
                              ...m,
                              [w.id]: err instanceof Error ? err.message : String(err),
                            })),
                          )
                          return
                        }
                        setModelDrafts((d) => ({ ...d, [w.id]: v }))
                        void Promise.resolve(onSetModel?.(w.id, v || null)).catch((err) =>
                          setModelErrors((m) => ({
                            ...m,
                            [w.id]: err instanceof Error ? err.message : String(err),
                          })),
                        )
                      }}
                    >
                      {modelsLoadingId === w.id ? (
                        <option value="__loading__">{t('workers.modelLoading')}</option>
                      ) : (
                        <>
                          <option value="__refresh__">
                            {w.availableModels?.length
                              ? t('workers.modelRefresh')
                              : t('workers.modelFetch')}
                          </option>
                          <option value="">{t('workers.modelDefault')}</option>
                          <option value="__manual__">{t('workers.modelManual')}</option>
                          {(w.availableModels ?? []).map((m) => (
                            <option key={m.modelId} value={m.modelId}>
                              {m.name !== m.modelId ? `${m.name} · ${m.modelId}` : m.modelId}
                            </option>
                          ))}
                          {w.model &&
                            !(w.availableModels ?? []).some((m) => m.modelId === w.model) && (
                              <option value={w.model}>{w.model}</option>
                            )}
                        </>
                      )}
                    </select>
                  </div>
                  {modelErrors[w.id] && (
                    <div className="worker-model-error" title={modelErrors[w.id]}>
                      {modelErrors[w.id]}
                    </div>
                  )}
                  <div className="worker-tags" style={{ alignItems: 'center' }}>
                    <span
                      className={`badge ${roleBadgeClass(w.primaryRole)}`}
                      style={{ cursor: 'pointer' }}
                      title={`${t('workers.primary')}: ${t(roleMessageKey(w.primaryRole))}`}
                      onClick={() => cyclePrimary(w)}
                    >
                      {t('workers.primary')}: {t(roleMessageKey(w.primaryRole))}
                    </span>
                    <button
                      type="button"
                      className="badge badge-gray"
                      style={{ cursor: 'pointer', border: 'none' }}
                      onClick={() => setEditingId(editingId === w.id ? null : w.id)}
                    >
                      {t('workers.roles')} ▾
                    </button>
                  </div>
                  {editingId === w.id && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                      {WORKER_ROLES.map((role) => {
                        const active = w.roles.includes(role)
                        return (
                          <button
                            key={role}
                            type="button"
                            className={`badge ${active ? roleBadgeClass(role) : 'badge-gray'}`}
                            style={{
                              cursor: 'pointer',
                              border: active
                                ? '1px solid var(--accent-border)'
                                : '1px solid transparent',
                              opacity: active ? 1 : 0.55,
                            }}
                            onClick={() => toggleRole(w, role)}
                          >
                            {t(roleMessageKey(role))}
                            {w.primaryRole === role ? ' ★' : ''}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <button
                  className={`toggle${w.enabled ? ' on' : ''}`}
                  type="button"
                  aria-label="toggle"
                  onClick={() => onToggle(w.id, !w.enabled)}
                />
              </div>
              )
            })}

            {showForm && (
              <div className="card mt-8">
                <div className="card-head">{t('workers.registerTitle')}</div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('workers.formName')}</label>
                  <input
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    style={{
                      height: 30,
                      padding: '0 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-app)',
                      color: 'var(--text)',
                    }}
                  />
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('workers.formCommand')}</label>
                  <input
                    value={regCommand}
                    onChange={(e) => setRegCommand(e.target.value)}
                    className="mono"
                    style={{
                      height: 30,
                      padding: '0 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-app)',
                      color: 'var(--text)',
                    }}
                  />
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('workers.formArgs')}</label>
                  <input
                    value={regArgs}
                    onChange={(e) => setRegArgs(e.target.value)}
                    className="mono"
                    style={{
                      height: 30,
                      padding: '0 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-app)',
                      color: 'var(--text)',
                    }}
                  />
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('workers.primary')}</label>
                  <select
                    value={regRole}
                    onChange={(e) => setRegRole(e.target.value as WorkerRole)}
                    style={{
                      height: 30,
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-app)',
                      color: 'var(--text)',
                    }}
                  >
                    {WORKER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(roleMessageKey(r))}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-soft btn-sm"
                    disabled={regBusy || !regName.trim() || !regCommand.trim()}
                    onClick={() => void submitWorker()}
                  >
                    {regBusy ? t('app.loading') : t('workers.formSave')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="tab-panel active">
          <div className="panel-header" style={{ height: 36 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('jobs.title')}
            </span>
            <div className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={jobsLoading}
              onClick={() => void loadJobs()}
            >
              {t('common.refresh')}
            </button>
          </div>
          <div className="scroll">
            <div className="job-dispatch-form">
              <label className="settings-field">
                <span>{t('jobs.dispatchRole')}</span>
                <select
                  className="settings-input"
                  value={dispatchRole}
                  onChange={(e) => setDispatchRole(e.target.value as WorkerRole)}
                >
                  {WORKER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(roleMessageKey(r))}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                className="job-dispatch-task"
                rows={3}
                value={dispatchTask}
                onChange={(e) => setDispatchTask(e.target.value)}
                placeholder={t('jobs.dispatchPlaceholder')}
              />
              <button
                type="button"
                className="btn btn-soft btn-sm"
                disabled={dispatchBusy || !dispatchTask.trim() || !sessionId}
                onClick={() => {
                  setDispatchBusy(true)
                  void api
                    .createJob({
                      task: dispatchTask.trim(),
                      role: dispatchRole,
                      sessionId: sessionId ?? undefined,
                      wait: false,
                    })
                    .then(() => {
                      setDispatchTask('')
                      onRefreshSnapshot()
                      return loadJobs()
                    })
                    .catch((e) => alert(String(e)))
                    .finally(() => setDispatchBusy(false))
                }}
              >
                {dispatchBusy ? t('app.loading') : t('jobs.dispatch')}
              </button>
              {!sessionId && (
                <p className="settings-muted mt-8">{t('jobs.needSession')}</p>
              )}
            </div>

            {jobsLoading && jobs.length === 0 && (
              <p className="settings-muted">{t('app.loading')}</p>
            )}
            {!jobsLoading && jobs.length === 0 && (
              <p className="settings-muted">{t('jobs.empty')}</p>
            )}
            {jobs.map((j) => {
              const open = expandedJobId === j.id
              const canCancel =
                j.status === 'queued' ||
                j.status === 'running' ||
                j.status === 'pending_approval'
              return (
                <div className="job-row" key={j.id}>
                  <div className="job-row-head">
                    <span className={jobStatusClass(j.status)}>{j.status}</span>
                    <span className="job-worker">{j.workerName}</span>
                    {j.role && (
                      <span className={`badge ${roleBadgeClass(j.role)}`}>{j.role}</span>
                    )}
                    <div className="spacer" />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setExpandedJobId(open ? null : j.id)}
                    >
                      {open ? '▴' : '▾'}
                    </button>
                    {canCancel && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          void api
                            .cancelJob(j.id)
                            .then(() => {
                              onRefreshSnapshot()
                              return loadJobs()
                            })
                            .catch((e) => alert(String(e)))
                        }}
                      >
                        {t('jobs.cancel')}
                      </button>
                    )}
                    {(j.status === 'failed' || j.status === 'cancelled' || j.status === 'timed_out') && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          void api
                            .retryJob(j.id, false)
                            .then(() => {
                              onRefreshSnapshot()
                              return loadJobs()
                            })
                            .catch((e) => alert(String(e)))
                        }}
                      >
                        {t('jobs.retry')}
                      </button>
                    )}
                  </div>
                  <div className="job-task">{j.task.slice(0, 160)}</div>
                  {open && (
                    <div className="job-detail">
                      <div className="mono">{j.id}</div>
                      {j.message && <div>{j.message}</div>}
                      {j.error && <div className="job-error">{j.error}</div>}
                      {j.output && (
                        <pre className="job-output mono">{j.output.slice(0, 4000)}</pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'git' && (
        <div className="tab-panel active">
          <div className="panel-header" style={{ height: 36 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {git?.branch ? `⎇ ${git.branch}` : t('right.git')}
            </span>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadGit()}>
              {t('common.refresh')}
            </button>
          </div>
          <div className="git-summary">
            <div className="stat">
              <div className="n" style={{ color: 'var(--success)' }}>
                {gitLoading ? '…' : git ? `+${git.insertions}` : '—'}
              </div>
              <div className="l">{t('git.insertions')}</div>
            </div>
            <div className="stat">
              <div className="n" style={{ color: 'var(--danger)' }}>
                {gitLoading ? '…' : git ? `−${git.deletions}` : '—'}
              </div>
              <div className="l">{t('git.deletions')}</div>
            </div>
          </div>
          <div className="scroll">
            {gitError && (
              <p style={{ padding: 12, color: 'var(--warning)', fontSize: 12 }}>{gitError}</p>
            )}
            {!gitError && git && git.files.length === 0 && (
              <p style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                {t('git.clean')}
              </p>
            )}
            {git?.files.map((f) => (
              <div className="file-row" key={f.path}>
                <span className={`status ${statusLetter(f.status)}`}>{statusLetter(f.status)}</span>
                <span>{f.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'files' && (
        <div className="tab-panel active">
          <div className="panel-header" style={{ height: 36 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('right.files')}</span>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadFiles()}>
              {t('common.refresh')}
            </button>
          </div>
          <div className="scroll">
            {filesLoading && (
              <p style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                {t('app.loading')}
              </p>
            )}
            {filesError && (
              <p style={{ padding: 12, color: 'var(--warning)', fontSize: 12 }}>{filesError}</p>
            )}
            {!filesLoading && !filesError && files && files.length === 0 && (
              <p style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                {t('files.empty')}
              </p>
            )}
            {files && <FileTree entries={files} />}
            {filesTruncated && (
              <p style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>
                {t('files.truncated')}
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'approvals' && (
        <div className="tab-panel active">
          <div className="panel-header" style={{ height: 36 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('approvals.pending')} (
              {approvals.filter((a) => a.status === 'pending').length})
            </span>
            <div className="spacer" />
            <button className="btn btn-soft btn-sm" type="button" onClick={onDemoApproval}>
              {t('approvals.demo')}
            </button>
          </div>
          <div className="scroll">
            {approvals.filter((a) => a.status === 'pending').length === 0 && (
              <p style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                {t('approvals.empty')}
              </p>
            )}
            {approvals
              .filter((a) => a.status === 'pending')
              .map((a) => (
                <div className="approval-item" key={a.id}>
                  <h4>{a.title}</h4>
                  {a.workerName && (
                    <p style={{ marginTop: 4 }}>
                      {t('approvals.worker')}: {a.workerName}
                    </p>
                  )}
                  {a.pathOrTarget && (
                    <p style={{ marginTop: 2 }}>
                      {t('approvals.target')}: {a.pathOrTarget}
                    </p>
                  )}
                  <div className="row mt-8">
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => onResolveApproval(a.id, 'deny')}
                    >
                      {t('approvals.deny')}
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={() => onResolveApproval(a.id, 'allow')}
                    >
                      {t('approvals.allow')}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {tab === 'goals' && (
        <div className="scroll" style={{ padding: 12 }}>
          <div className="panel-header" style={{ padding: '0 0 8px' }}>
            <h2 style={{ fontSize: 13 }}>{t('goals.title')}</h2>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void loadGoal()}
            >
              {t('common.refresh')}
            </button>
          </div>
          <p className="settings-muted" style={{ marginBottom: 10 }}>
            {t('goals.hint')}
          </p>
          {goalStatus.error && (
            <p className="settings-error" style={{ marginBottom: 8 }}>
              {goalStatus.error}
            </p>
          )}
          {goalStatus.objective ? (
            <div className="card" style={{ marginBottom: 10 }}>
              <div className="card-head">
                <span className="badge badge-blue">{t('goals.status')}</span>
                {goalStatus.status ?? 'active'}
              </div>
              <div className="card-body" style={{ whiteSpace: 'pre-wrap' }}>
                {goalStatus.objective}
              </div>
              {goalStatus.threadId && (
                <div className="settings-mono" style={{ padding: '0 10px 8px' }}>
                  {t('goals.thread')}: {goalStatus.threadId}
                </div>
              )}
            </div>
          ) : (
            <p className="settings-muted" style={{ marginBottom: 10 }}>
              {t('goals.empty')}
            </p>
          )}
          <textarea
            className="settings-input"
            style={{ height: 80, padding: 8, resize: 'vertical' }}
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            placeholder={t('goals.placeholder')}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={goalBusy || !goalText.trim()}
              onClick={() => {
                void (async () => {
                  setGoalBusy(true)
                  try {
                    await api.setGoal({
                      objective: goalText.trim(),
                      threadId: memoryThreadId ?? undefined,
                      resourceId: projectId ?? undefined,
                    })
                    await loadGoal()
                  } catch (e) {
                    alert(String(e))
                  } finally {
                    setGoalBusy(false)
                  }
                })()
              }}
            >
              {t('goals.set')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={goalBusy}
              onClick={() => {
                void (async () => {
                  setGoalBusy(true)
                  try {
                    await api.clearGoal(memoryThreadId ?? undefined)
                    setGoalText('')
                    await loadGoal()
                  } catch (e) {
                    alert(String(e))
                  } finally {
                    setGoalBusy(false)
                  }
                })()
              }}
            >
              {t('goals.clear')}
            </button>
          </div>
          {memoryInfo && (
            <p className="settings-mono" style={{ marginTop: 14, fontSize: 10 }}>
              Memory: {memoryInfo}
            </p>
          )}
          {controllerInfo && (
            <p className="settings-mono" style={{ marginTop: 4, fontSize: 10 }}>
              Controller: {controllerInfo}
            </p>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <ActivityTab />
      )}
    </aside>
  )
}

function ActivityTab() {
  const { t } = useI18n()
  const [events, setEvents] = useState<
    { id: string; at: string; kind: string; message: string }[]
  >([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.activity(80)
      setEvents(data.events)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [load])

  const time = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return '—'
    }
  }

  return (
    <div className="tab-panel active">
      <div className="panel-header" style={{ height: 36 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('right.activity')}</span>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void load()}>
          {t('common.refresh')}
        </button>
      </div>
      <div className="scroll">
        {err && (
          <p style={{ padding: 12, color: 'var(--warning)', fontSize: 12 }}>{err}</p>
        )}
        {!err && events.length === 0 && (
          <p style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
            {t('activity.empty')}
          </p>
        )}
        {events.map((e) => (
          <div className="activity-item" key={e.id}>
            <div className="t">{time(e.at)}</div>
            <div className="d">
              <strong>{e.kind}</strong> {e.message}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
