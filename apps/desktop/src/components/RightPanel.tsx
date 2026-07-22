import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApprovalItem,
  CreateRoleDefinitionInput,
  RoleDefinition,
  UpdateRoleDefinitionInput,
  WorkerJob,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { WORKER_ROLES } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import { roleMessageKey } from '../i18n/locales'
import { api, type FileEntryDto, type GitStatusResponse } from '../lib/api'
import { ApprovalActions } from './ApprovalActions'
import { useToast } from './Toast'

type Tab = 'roles' | 'git' | 'files' | 'approvals'

function statusLetter(status: string): string {
  if (status === '??') return '?'
  return status.replace(/\s/g, '')[0] ?? 'M'
}

function FileTree({ entries, depth = 0 }: { entries: FileEntryDto[]; depth?: number }) {
  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path}>
          <div
            className={`tree-item w-row inspector-list-row${entry.type === 'directory' ? ' folder' : ''}`}
            style={{ paddingLeft: 10 + depth * 12 }}
          >
            <span className="tree-item-ico" aria-hidden>
              {entry.type === 'directory' ? '▾' : '·'}
            </span>
            <div className="info">
              <div className="n">{entry.name}</div>
            </div>
          </div>
          {entry.children && entry.children.length > 0 && (
            <FileTree entries={entry.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  )
}

interface Props {
  workers: WorkerRegistration[]
  roleDefinitions: RoleDefinition[]
  approvals: ApprovalItem[]
  projectId: string | null
  sessionId?: string | null
  onCreateRoleDefinition: (body: Omit<CreateRoleDefinitionInput, 'chatSessionId'>) => Promise<void>
  onUpdateRoleDefinition: (id: string, body: UpdateRoleDefinitionInput) => Promise<void>
  onArchiveRoleDefinition: (id: string, expectedRevision: number) => Promise<void>
  onResetRoleSession: (id: string) => Promise<void>
  onResolveApproval: (
    approvalId: string,
    optionId: string | undefined,
    decision: 'allow' | 'deny' | 'cancel',
    surface: 'chat' | 'panel',
  ) => void
  resolving?: Record<string, boolean>
  onRefreshSnapshot: () => void
}

type RoleDraft = {
  name: string
  workerId: string
  roleType: WorkerRole
  instructions: string
  model: string
}

const EMPTY_ROLE_DRAFT: RoleDraft = {
  name: '',
  workerId: '',
  roleType: 'general',
  instructions: '',
  model: '',
}

export function RightPanel({
  workers,
  roleDefinitions,
  approvals,
  projectId,
  sessionId,
  onCreateRoleDefinition,
  onUpdateRoleDefinition,
  onArchiveRoleDefinition,
  onResetRoleSession,
  onResolveApproval,
  resolving = {},
  onRefreshSnapshot,
}: Props) {
  const { t } = useI18n()
  const { success: toastSuccess, error: toastError } = useToast()
  const [tab, setTab] = useState<Tab>('roles')
  const [git, setGit] = useState<GitStatusResponse | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<string | null>(null)
  const [files, setFiles] = useState<FileEntryDto[] | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [filesTruncated, setFilesTruncated] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(EMPTY_ROLE_DRAFT)
  const [roleBusy, setRoleBusy] = useState(false)
  const [roleJobs, setRoleJobs] = useState<WorkerJob[]>([])
  const [dispatchTasks, setDispatchTasks] = useState<Record<string, string>>({})
  const [dispatchingRoleId, setDispatchingRoleId] = useState<string | null>(null)
  const gitRequestGen = useRef(0)
  const filesRequestGen = useRef(0)
  const projectScopeRef = useRef(projectId)
  projectScopeRef.current = projectId

  const enabledWorkers = workers.filter((worker) => worker.enabled)

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
      if (gen !== gitRequestGen.current || projectScopeRef.current !== requestProjectId) return
      setGit(data)
      if (!data.ok) setGitError(data.error ?? t('git.error'))
    } catch (error) {
      if (gen !== gitRequestGen.current || projectScopeRef.current !== requestProjectId) return
      setGit(null)
      setGitError(error instanceof Error ? error.message : String(error))
    } finally {
      if (gen === gitRequestGen.current && projectScopeRef.current === requestProjectId) {
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
      if (gen !== filesRequestGen.current || projectScopeRef.current !== requestProjectId) return
      if (!data.ok) {
        setFiles(null)
        setFilesError(data.error ?? t('files.error'))
      } else {
        setFiles(data.entries)
        setFilesTruncated(data.truncated)
      }
    } catch (error) {
      if (gen !== filesRequestGen.current || projectScopeRef.current !== requestProjectId) return
      setFiles(null)
      setFilesError(error instanceof Error ? error.message : String(error))
    } finally {
      if (gen === filesRequestGen.current && projectScopeRef.current === requestProjectId) {
        setFilesLoading(false)
      }
    }
  }, [projectId, t])

  const loadRoleJobs = useCallback(async () => {
    if (!sessionId) {
      setRoleJobs([])
      return
    }
    const result = await api.listJobs({ sessionId, limit: 100 })
    setRoleJobs(result.jobs)
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
    if (tab === 'git') void loadGit()
    if (tab === 'files') void loadFiles()
    if (tab === 'roles') void loadRoleJobs()
  }, [tab, loadGit, loadFiles, loadRoleJobs])

  useEffect(() => {
    setEditingId(null)
    setRoleDraft(EMPTY_ROLE_DRAFT)
    setDispatchTasks({})
    void loadRoleJobs()
  }, [sessionId, loadRoleJobs])

  const startCreateRole = () => {
    setEditingId('new')
    setRoleDraft({ ...EMPTY_ROLE_DRAFT, workerId: enabledWorkers[0]?.id ?? '' })
  }

  const startEditRole = (role: RoleDefinition) => {
    setEditingId(role.id)
    setRoleDraft({
      name: role.name,
      workerId: role.workerId,
      roleType: role.roleType,
      instructions: role.instructions,
      model: role.model ?? '',
    })
  }

  const saveRole = async () => {
    if (!roleDraft.name.trim() || !roleDraft.workerId || !roleDraft.instructions.trim()) return
    setRoleBusy(true)
    try {
      if (editingId === 'new') {
        await onCreateRoleDefinition({
          workerId: roleDraft.workerId,
          name: roleDraft.name.trim(),
          roleType: roleDraft.roleType,
          instructions: roleDraft.instructions.trim(),
          model: roleDraft.model.trim() || undefined,
          enabled: true,
        })
      } else if (editingId) {
        const role = roleDefinitions.find((item) => item.id === editingId)
        if (!role) return
        await onUpdateRoleDefinition(editingId, {
          workerId: roleDraft.workerId,
          name: roleDraft.name.trim(),
          roleType: roleDraft.roleType,
          instructions: roleDraft.instructions.trim(),
          model: roleDraft.model.trim() || null,
          expectedRevision: role.revision,
        })
      }
      setEditingId(null)
      setRoleDraft(EMPTY_ROLE_DRAFT)
      toastSuccess(t('roles.saved'))
    } catch (error) {
      toastError(error instanceof Error ? error.message : String(error))
    } finally {
      setRoleBusy(false)
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'roles', label: t('right.roles') },
    { id: 'git', label: t('right.git') },
    { id: 'files', label: t('right.files') },
    { id: 'approvals', label: t('right.approvals') },
  ]

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

      {tab === 'roles' && (
        <div className="drawer-body tab-panel active">
          <div className="inspector-panel-head">
            <div className="inspector-panel-title">{t('right.roles')}</div>
            <button
              className="settings-btn-soft"
              type="button"
              disabled={!sessionId || enabledWorkers.length === 0 || editingId === 'new'}
              onClick={startCreateRole}
            >
              {t('roles.add')}
            </button>
          </div>
          <p className="section-hint">{t('right.rolesHint')}</p>
          {!sessionId && <p className="section-hint is-warn">{t('roles.needSession')}</p>}
          {sessionId && enabledWorkers.length === 0 && (
            <p className="section-hint is-warn">{t('roles.noWorkers')}</p>
          )}

          {editingId && (
            <div className="inspector-approval-card" style={{ padding: 12, marginBottom: 10 }}>
              <div className="settings-field">
                <label htmlFor="role-name">{t('roles.name')}</label>
                <input
                  id="role-name"
                  className="settings-input ui-font"
                  value={roleDraft.name}
                  onChange={(event) =>
                    setRoleDraft((draft) => ({ ...draft, name: event.target.value }))
                  }
                />
              </div>
              <div className="settings-field" style={{ marginTop: 10 }}>
                <label htmlFor="role-worker">{t('roles.worker')}</label>
                <select
                  id="role-worker"
                  className="settings-select"
                  value={roleDraft.workerId}
                  onChange={(event) =>
                    setRoleDraft((draft) => ({ ...draft, workerId: event.target.value }))
                  }
                >
                  {enabledWorkers.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-field" style={{ marginTop: 10 }}>
                <label htmlFor="role-type">{t('roles.type')}</label>
                <select
                  id="role-type"
                  className="settings-select"
                  value={roleDraft.roleType}
                  onChange={(event) =>
                    setRoleDraft((draft) => ({
                      ...draft,
                      roleType: event.target.value as WorkerRole,
                    }))
                  }
                >
                  {WORKER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(roleMessageKey(role))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-field" style={{ marginTop: 10 }}>
                <label htmlFor="role-instructions">{t('roles.instructions')}</label>
                <textarea
                  id="role-instructions"
                  className="settings-input ui-font"
                  style={{
                    minHeight: 92,
                    height: 92,
                    padding: 10,
                    lineHeight: 1.4,
                    whiteSpace: 'normal',
                  }}
                  value={roleDraft.instructions}
                  onChange={(event) =>
                    setRoleDraft((draft) => ({ ...draft, instructions: event.target.value }))
                  }
                />
              </div>
              <div className="settings-field" style={{ marginTop: 10 }}>
                <label htmlFor="role-model">{t('roles.model')}</label>
                <input
                  id="role-model"
                  className="settings-input"
                  placeholder={t('roles.modelInherit')}
                  value={roleDraft.model}
                  onChange={(event) =>
                    setRoleDraft((draft) => ({ ...draft, model: event.target.value }))
                  }
                />
              </div>
              <div className="inspector-actions" style={{ marginTop: 12 }}>
                <button
                  className="settings-btn-soft"
                  type="button"
                  onClick={() => {
                    setEditingId(null)
                    setRoleDraft(EMPTY_ROLE_DRAFT)
                  }}
                >
                  {t('prompt.cancel')}
                </button>
                <button
                  className="settings-save-btn"
                  type="button"
                  disabled={
                    roleBusy ||
                    !roleDraft.name.trim() ||
                    !roleDraft.workerId ||
                    !roleDraft.instructions.trim()
                  }
                  onClick={() => void saveRole()}
                >
                  {roleBusy ? t('app.loading') : t('roles.save')}
                </button>
              </div>
            </div>
          )}

          {sessionId && roleDefinitions.length === 0 && !editingId && (
            <p className="section-hint">{t('roles.empty')}</p>
          )}
          {roleDefinitions.map((role) => {
            const worker = workers.find((item) => item.id === role.workerId)
            const openJobs = roleJobs.filter(
              (job) =>
                job.roleDefinitionId === role.id &&
                ['queued', 'running', 'pending_approval'].includes(job.status),
            )
            const effectiveModel = role.model
              ? role.model
              : worker?.model
                ? t('roles.inheritsWorker', { model: worker.model })
                : t('roles.acpDefault')
            return (
              <div className="inspector-approval-card" key={role.id} style={{ marginBottom: 10 }}>
                <div className="inspector-approval-title">{role.name}</div>
                <div className="inspector-approval-meta">
                  {t(roleMessageKey(role.roleType))} · {worker?.name ?? t('roles.workerMissing')}
                </div>
                <div className="inspector-approval-meta">
                  {worker?.readiness?.status ??
                    worker?.acpHealth?.status ??
                    worker?.health ??
                    'unknown'}
                  {' · '}
                  {openJobs.length > 0
                    ? t('roles.openJobs', { count: openJobs.length })
                    : t('roles.idle')}
                </div>
                <div className="inspector-approval-meta mono">{effectiveModel}</div>
                <div className="inspector-approval-meta">{role.instructions}</div>
                <div style={{ padding: '6px 12px 0' }}>
                  <input
                    className="settings-input ui-font"
                    placeholder={t('roles.dispatchPlaceholder')}
                    value={dispatchTasks[role.id] ?? ''}
                    onChange={(event) =>
                      setDispatchTasks((current) => ({
                        ...current,
                        [role.id]: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="inspector-actions" style={{ padding: '6px 12px 10px' }}>
                  <button
                    className="settings-save-btn"
                    type="button"
                    disabled={
                      dispatchingRoleId === role.id || !(dispatchTasks[role.id] ?? '').trim()
                    }
                    onClick={() => {
                      const task = (dispatchTasks[role.id] ?? '').trim()
                      if (!task || !sessionId) return
                      setDispatchingRoleId(role.id)
                      void api
                        .createJob({
                          task,
                          roleDefinitionId: role.id,
                          sessionId,
                          wait: false,
                        })
                        .then(() => {
                          setDispatchTasks((current) => ({ ...current, [role.id]: '' }))
                          toastSuccess(t('roles.dispatched'))
                          return loadRoleJobs()
                        })
                        .catch((error) =>
                          toastError(error instanceof Error ? error.message : String(error)),
                        )
                        .finally(() => setDispatchingRoleId(null))
                    }}
                  >
                    {dispatchingRoleId === role.id ? t('app.loading') : t('roles.dispatch')}
                  </button>
                  <button
                    className="settings-btn-soft"
                    type="button"
                    onClick={() => startEditRole(role)}
                  >
                    {t('roles.edit')}
                  </button>
                  <button
                    className="settings-btn-soft"
                    type="button"
                    onClick={() => {
                      setEditingId('new')
                      setRoleDraft({
                        name: `${role.name} ${t('roles.copySuffix')}`,
                        workerId: role.workerId,
                        roleType: role.roleType,
                        instructions: role.instructions,
                        model: role.model ?? '',
                      })
                    }}
                  >
                    {t('roles.copy')}
                  </button>
                  <button
                    className="settings-btn-soft"
                    type="button"
                    disabled={openJobs.length > 0}
                    title={openJobs.length > 0 ? t('roles.resetBlocked') : undefined}
                    onClick={() =>
                      void onResetRoleSession(role.id)
                        .then(() => toastSuccess(t('roles.sessionReset')))
                        .catch((error) =>
                          toastError(error instanceof Error ? error.message : String(error)),
                        )
                    }
                  >
                    {t('roles.resetSession')}
                  </button>
                  <button
                    className="settings-btn-soft"
                    type="button"
                    onClick={() =>
                      void onArchiveRoleDefinition(role.id, role.revision).catch((error) =>
                        toastError(error instanceof Error ? error.message : String(error)),
                      )
                    }
                  >
                    {t('roles.archive')}
                  </button>
                </div>
              </div>
            )
          })}
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
          {git?.files.map((file) => (
            <div className="w-row inspector-list-row" key={file.path}>
              <span className={`git-status-badge ${statusLetter(file.status)}`}>
                {statusLetter(file.status)}
              </span>
              <div className="info">
                <div className="n mono">{file.path}</div>
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
              {t('approvals.pending')} (
              {approvals.filter((item) => item.status === 'pending').length})
            </div>
            <button className="settings-btn-soft" type="button" onClick={onRefreshSnapshot}>
              {t('common.refresh')}
            </button>
          </div>
          {approvals.filter((item) => item.status === 'pending').length === 0 && (
            <p className="section-hint">{t('approvals.empty')}</p>
          )}
          {approvals
            .filter((item) => item.status === 'pending')
            .map((approval) => (
              <div className="inspector-approval-card" key={approval.id}>
                <div className="inspector-approval-title">{approval.title}</div>
                {approval.workerName && (
                  <div className="inspector-approval-meta">
                    {t('approvals.worker')}: {approval.workerName}
                  </div>
                )}
                {approval.pathOrTarget && (
                  <div className="inspector-approval-meta mono">
                    {t('approvals.target')}: {approval.pathOrTarget}
                  </div>
                )}
                <div className="approval-row inspector-approval-actions">
                  <ApprovalActions
                    approval={approval}
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
