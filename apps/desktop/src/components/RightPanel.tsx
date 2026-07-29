import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApprovalItem,
  CreateTeamMemberInput,
  TeamMember,
  UpdateTeamMemberInput,
  WorkerJob,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { normalizePromptSettings, WORKER_ROLES } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import { roleMessageKey } from '../i18n/locales'
import { api, type FileEntryDto, type GitStatusResponse } from '../lib/api'
import { ConfirmDialog, type ConfirmDialogConfig } from './ui/ConfirmDialog'
import { fetchSettings } from '../lib/settings'
import {
  roleDraftFromWorker,
  roleDraftWithDefaultPrompt,
  roleDraftWithType,
} from '../lib/role-prompt-defaults'
import { ApprovalActions } from './ApprovalActions'
import { WorkerBrandLogo } from './Icons'
import { Modal } from './ui/Modal'
import { WorkerReadinessBadge } from './WorkerReadinessBadge'
import { WorkerReasoningSelect } from './WorkerReasoningSelect'
import { useToast } from './Toast'
import { TeamTemplateManager } from './TeamTemplateManager'

function workerLogoClass(kind?: string): string {
  if (kind === 'claude' || kind === 'codex' || kind === 'opencode' || kind === 'gemini') {
    return kind
  }
  return 'custom'
}

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
  teamMembers: TeamMember[]
  approvals: ApprovalItem[]
  projectId: string | null
  sessionId?: string | null
  onCreateTeamMember: (body: Omit<CreateTeamMemberInput, 'chatSessionId'>) => Promise<void>
  onUpdateTeamMember: (id: string, body: UpdateTeamMemberInput) => Promise<void>
  onArchiveTeamMember: (id: string, expectedRevision: number) => Promise<void>
  onResetTeamMemberSession: (id: string) => Promise<void>
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
  reasoning: string
}

const EMPTY_ROLE_DRAFT: RoleDraft = {
  name: '',
  workerId: '',
  roleType: 'general',
  instructions: '',
  model: '',
  reasoning: '',
}

export function RightPanel({
  workers,
  teamMembers,
  approvals,
  projectId,
  sessionId,
  onCreateTeamMember,
  onUpdateTeamMember,
  onArchiveTeamMember,
  onResetTeamMemberSession,
  onResolveApproval,
  resolving = {},
  onRefreshSnapshot,
}: Props) {
  const { t, locale } = useI18n()
  const { success: toastSuccess, error: toastError } = useToast()
  const [tab, setTab] = useState<Tab>('roles')
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmDialogConfig | null>(null)
  const [git, setGit] = useState<GitStatusResponse | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<string | null>(null)
  const [files, setFiles] = useState<FileEntryDto[] | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [filesTruncated, setFilesTruncated] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(EMPTY_ROLE_DRAFT)
  const [rolePrompts, setRolePrompts] = useState(() => normalizePromptSettings(undefined).roles)
  const [roleBusy, setRoleBusy] = useState(false)
  const [roleReasoningValid, setRoleReasoningValid] = useState(true)
  const [roleJobs, setRoleJobs] = useState<WorkerJob[]>([])
  const gitRequestGen = useRef(0)
  const filesRequestGen = useRef(0)
  const projectScopeRef = useRef(projectId)
  projectScopeRef.current = projectId

  const enabledWorkers = workers.filter((worker) => worker.enabled)

  useEffect(() => {
    let cancelled = false
    void fetchSettings()
      .then((settings) => {
        if (!cancelled) setRolePrompts(normalizePromptSettings(settings.settings.prompts).roles)
      })
      .catch(() => {
        // Built-in templates remain available when settings cannot be loaded.
      })
    return () => {
      cancelled = true
    }
  }, [])

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
    void loadRoleJobs()
  }, [sessionId, loadRoleJobs])

  const startCreateRole = () => {
    setEditingId('new')
    const worker = enabledWorkers[0]
    setRoleDraft(
      worker ? { ...roleDraftFromWorker(worker, rolePrompts), reasoning: '' } : EMPTY_ROLE_DRAFT,
    )
    setRoleReasoningValid(true)
  }

  const startEditRole = (role: TeamMember) => {
    setEditingId(role.id)
    setRoleDraft({
      name: role.name,
      workerId: role.workerId,
      roleType: role.roleType,
      instructions: role.instructions,
      model: role.model ?? '',
      reasoning: role.reasoning ?? '',
    })
    setRoleReasoningValid(!role.reasoning)
  }

  const closeRoleEditor = () => {
    setEditingId(null)
    setRoleDraft(EMPTY_ROLE_DRAFT)
    setRoleReasoningValid(true)
  }

  const saveRole = async () => {
    if (
      !roleDraft.name.trim() ||
      !roleDraft.workerId ||
      !roleDraft.instructions.trim() ||
      !roleReasoningValid
    )
      return
    setRoleBusy(true)
    try {
      if (editingId === 'new') {
        await onCreateTeamMember({
          workerId: roleDraft.workerId,
          name: roleDraft.name.trim(),
          roleType: roleDraft.roleType,
          instructions: roleDraft.instructions.trim(),
          model: roleDraft.model.trim() || undefined,
          reasoning: roleDraft.reasoning.trim() || undefined,
          enabled: true,
        })
      } else if (editingId) {
        const role = teamMembers.find((item) => item.id === editingId)
        if (!role) return
        await onUpdateTeamMember(editingId, {
          workerId: roleDraft.workerId,
          name: roleDraft.name.trim(),
          roleType: roleDraft.roleType,
          instructions: roleDraft.instructions.trim(),
          model: roleDraft.model.trim() || null,
          reasoning: roleDraft.reasoning.trim() || null,
          expectedRevision: role.revision,
        })
      }
      closeRoleEditor()
      toastSuccess(t('roles.saved'))
    } catch (error) {
      toastError(error instanceof Error ? error.message : String(error))
    } finally {
      setRoleBusy(false)
    }
  }

  const roleModalOpen = editingId !== null
  const roleModalTitle = editingId === 'new' ? t('roles.add') : t('roles.edit')
  const roleFormValid =
    Boolean(roleDraft.name.trim()) &&
    Boolean(roleDraft.workerId) &&
    Boolean(roleDraft.instructions.trim())

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
        <div className="drawer-body tab-panel active crew-panel">
          <div className="crew-panel-toolbar">
            <div className="crew-panel-heading">
              <div className="inspector-panel-title">{t('right.roles')}</div>
              <p className="crew-panel-hint">{t('right.rolesHint')}</p>
            </div>
            <div className="crew-panel-actions">
              <TeamTemplateManager
                sessionId={sessionId}
                teamMembers={teamMembers}
                workers={workers}
                projectId={projectId}
                openJobCount={
                  roleJobs.filter((job) =>
                    ['queued', 'running', 'pending_approval'].includes(job.status),
                  ).length
                }
                onApplied={() => {
                  onRefreshSnapshot()
                  void loadRoleJobs()
                }}
              />
              <button
                className="settings-save-btn crew-add-btn"
                type="button"
                disabled={!sessionId || enabledWorkers.length === 0 || roleModalOpen}
                onClick={startCreateRole}
              >
                {t('roles.add')}
              </button>
            </div>
          </div>
          {!sessionId && <p className="section-hint is-warn">{t('roles.needSession')}</p>}
          {sessionId && enabledWorkers.length === 0 && (
            <p className="section-hint is-warn">{t('roles.noWorkers')}</p>
          )}

          {sessionId && teamMembers.length === 0 && (
            <p className="section-hint">{t('roles.empty')}</p>
          )}

          <div className="role-card-list">
            {teamMembers.map((role) => {
              const worker = workers.find((item) => item.id === role.workerId)
              const openJobs = roleJobs.filter(
                (job) =>
                  job.teamMemberId === role.id &&
                  ['queued', 'running', 'pending_approval'].includes(job.status),
              )
              const busy = openJobs.length > 0
              const effectiveModel = role.model
                ? role.model
                : worker?.model
                  ? t('roles.inheritsWorker', { model: worker.model })
                  : t('roles.acpDefault')
              const workerLabel = worker?.name ?? t('roles.workerMissing')
              return (
                <article
                  className={`role-card${busy ? ' is-busy' : ''}${!worker ? ' is-missing' : ''}`}
                  key={role.id}
                >
                  <header className="role-card-header">
                    <span
                      className={`worker-logo role-card-avatar ${workerLogoClass(worker?.kind)}`}
                      title={workerLabel}
                      aria-hidden
                    >
                      <WorkerBrandLogo kind={worker?.kind ?? 'custom'} size={15} />
                    </span>
                    <div className="role-card-identity">
                      <div className="role-card-title-row">
                        <span className="role-card-name" title={role.name}>
                          {role.name}
                        </span>
                        <span className="role-card-type">{t(roleMessageKey(role.roleType))}</span>
                      </div>
                      <div className="role-card-binding" title={workerLabel}>
                        {workerLabel}
                      </div>
                    </div>
                    <span
                      className={`role-card-status${busy ? ' is-busy' : ' is-idle'}`}
                      title={
                        busy ? t('roles.openJobs', { count: openJobs.length }) : t('roles.idle')
                      }
                    >
                      <span className="role-card-status-dot" aria-hidden />
                      {busy ? t('roles.openJobs', { count: openJobs.length }) : t('roles.idle')}
                    </span>
                  </header>

                  <div className="role-card-body">
                    <div className="role-card-facts">
                      <div className="role-card-fact">
                        <span className="role-card-fact-k">{t('roles.factWorker')}</span>
                        <span className="role-card-fact-v">
                          {worker?.readiness ? (
                            <WorkerReadinessBadge
                              status={worker.readiness.status}
                              code={worker.readiness.code}
                              nextAction={worker.readiness.nextAction}
                              locale={locale === 'zh' ? 'zh' : 'en'}
                            />
                          ) : (
                            <span className="role-card-health">
                              {worker?.acpHealth?.status ?? worker?.health ?? 'unknown'}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="role-card-fact">
                        <span className="role-card-fact-k">{t('roles.factModel')}</span>
                        <span className="role-card-fact-v mono" title={effectiveModel}>
                          {effectiveModel}
                        </span>
                      </div>
                    </div>

                    <div className="role-card-prompt">
                      <span className="role-card-prompt-label">{t('roles.instructions')}</span>
                      <p className="role-card-instructions" title={role.instructions}>
                        {role.instructions.trim() || '—'}
                      </p>
                    </div>
                  </div>

                  <footer className="role-card-actions">
                    <button
                      className="role-card-action"
                      type="button"
                      onClick={() => startEditRole(role)}
                    >
                      {t('roles.edit')}
                    </button>
                    <button
                      className="role-card-action"
                      type="button"
                      disabled={busy}
                      title={busy ? t('roles.resetBlocked') : undefined}
                      onClick={() =>
                        setPendingConfirm({
                          title: t('roles.resetSession'),
                          message: t('roles.confirmResetSession', { name: role.name }),
                          confirmLabel: t('common.confirm'),
                          cancelLabel: t('common.cancel'),
                          onConfirm: async () => {
                            try {
                              await onResetTeamMemberSession(role.id)
                              toastSuccess(t('roles.sessionReset'))
                            } catch (error) {
                              toastError(error instanceof Error ? error.message : String(error))
                            }
                          },
                        })
                      }
                    >
                      {t('roles.resetSession')}
                    </button>
                    <button
                      className="role-card-action is-danger"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setPendingConfirm({
                          title: t('roles.confirmArchiveTitle'),
                          message: t('roles.confirmArchive', { name: role.name }),
                          confirmLabel: t('common.confirmDelete'),
                          cancelLabel: t('common.cancel'),
                          danger: true,
                          onConfirm: async () => {
                            try {
                              await onArchiveTeamMember(role.id, role.revision)
                              toastSuccess(t('roles.archived'))
                            } catch (error) {
                              toastError(error instanceof Error ? error.message : String(error))
                            }
                          },
                        })
                      }
                    >
                      {t('roles.archive')}
                    </button>
                  </footer>
                </article>
              )
            })}
          </div>

          <Modal
            open={roleModalOpen}
            onClose={() => {
              if (!roleBusy) closeRoleEditor()
            }}
            label={roleModalTitle}
            panelClassName="text-prompt-modal role-form-modal"
            closeOnBackdrop={false}
            closeOnEsc={false}
          >
            <h2>{roleModalTitle}</h2>
            <div className="role-form-fields">
              <div className="role-form-field">
                <label htmlFor="role-name">{t('roles.name')}</label>
                <input
                  id="role-name"
                  className="settings-input ui-font"
                  value={roleDraft.name}
                  autoFocus
                  onChange={(event) =>
                    setRoleDraft((draft) => ({ ...draft, name: event.target.value }))
                  }
                />
              </div>
              <div className="role-form-grid">
                <div className="role-form-field">
                  <label htmlFor="role-worker">{t('roles.worker')}</label>
                  <select
                    id="role-worker"
                    className="settings-select"
                    value={roleDraft.workerId}
                    onChange={(event) => {
                      const workerId = event.target.value
                      const worker = enabledWorkers.find((item) => item.id === workerId)
                      setRoleDraft((draft) =>
                        editingId === 'new' && worker
                          ? { ...roleDraftFromWorker(worker, rolePrompts), reasoning: '' }
                          : { ...draft, workerId },
                      )
                    }}
                  >
                    {enabledWorkers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="role-form-field">
                  <label htmlFor="role-type">{t('roles.type')}</label>
                  <select
                    id="role-type"
                    className="settings-select"
                    value={roleDraft.roleType}
                    onChange={(event) => {
                      const roleType = event.target.value as WorkerRole
                      setRoleDraft((draft) => roleDraftWithType(draft, roleType, rolePrompts))
                    }}
                  >
                    {WORKER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t(roleMessageKey(role))}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="role-form-field">
                <div className="role-form-label-row">
                  <label htmlFor="role-instructions">{t('roles.instructions')}</label>
                  <button
                    className="settings-btn-soft"
                    type="button"
                    onClick={() =>
                      setRoleDraft((draft) => roleDraftWithDefaultPrompt(draft, rolePrompts))
                    }
                  >
                    {t('roles.useDefaultPrompt')}
                  </button>
                </div>
                <textarea
                  id="role-instructions"
                  className="settings-input ui-font role-form-instructions"
                  rows={5}
                  value={roleDraft.instructions}
                  onChange={(event) =>
                    setRoleDraft((draft) => ({ ...draft, instructions: event.target.value }))
                  }
                />
              </div>
              <div className="role-form-field">
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
              <div className="role-form-field">
                <label htmlFor="role-reasoning">{t('reasoning.intensity')}</label>
                <WorkerReasoningSelect
                  id="role-reasoning"
                  workerId={roleDraft.workerId}
                  model={
                    roleDraft.model.trim() ||
                    enabledWorkers.find((worker) => worker.id === roleDraft.workerId)?.model
                  }
                  projectId={projectId}
                  value={roleDraft.reasoning}
                  inheritLabel={t('reasoning.inheritWorker')}
                  disabled={roleBusy}
                  onChange={(reasoning) => setRoleDraft((draft) => ({ ...draft, reasoning }))}
                  onValidityChange={setRoleReasoningValid}
                />
              </div>
            </div>
            <div className="role-form-footer">
              <button
                className="settings-btn-soft"
                type="button"
                disabled={roleBusy}
                onClick={closeRoleEditor}
              >
                {t('prompt.cancel')}
              </button>
              <button
                className="settings-save-btn"
                type="button"
                disabled={roleBusy || !roleFormValid || !roleReasoningValid}
                onClick={() => void saveRole()}
              >
                {roleBusy ? t('app.loading') : t('roles.save')}
              </button>
            </div>
          </Modal>
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
      <ConfirmDialog
        open={!!pendingConfirm}
        config={pendingConfirm}
        onClose={() => setPendingConfirm(null)}
      />
    </aside>
  )
}
