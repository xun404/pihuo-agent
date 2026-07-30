import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  TeamTemplate,
  TeamTemplateMember,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { WORKER_ROLES } from '@swarmdesk-agent/shared'
import { api } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { roleMessageKey } from '../i18n/locales'
import { useToast } from './Toast'
import { resolveWorkerIconAgentId, WorkerBrandLogo, workerBrandClass } from './Icons'
import { Expandable } from './ui/Expandable'
import { WorkerReasoningSelect } from './WorkerReasoningSelect'

export type TeamTemplateLibraryProps = {
  workers: WorkerRegistration[]
  projectId?: string | null
  /** Snapshot-backed list when available; library still refreshes via API after mutations. */
  initialTemplates?: TeamTemplate[]
  /** Called after create/update/delete so App snapshot stays warm. */
  onChanged?: () => void
  /** Pre-select a template when opening from the sidebar. */
  focusTemplateId?: string | null
  className?: string
  /**
   * `settings` — same master/detail shell as 模型设置 (rail + main, full page).
   * `modal` — compact split used by the sidebar popup.
   */
  layout?: 'settings' | 'modal'
  /**
   * When true (settings layout only), hide the internal rail — the parent owns selection via
   * `focusTemplateId`. Used when the library is embedded in a page that already has its own rail
   * (e.g. the merged workers tab).
   */
  hideRail?: boolean
}

const ROLE_TONE: Record<WorkerRole, string> = {
  plan: 'plan',
  coder: 'coder',
  review: 'review',
  test: 'test',
  research: 'research',
  general: 'general',
}

function workerOf(workers: WorkerRegistration[], workerId: string) {
  return workers.find((worker) => worker.id === workerId)
}

function roleTone(roleType: string): string {
  return ROLE_TONE[roleType as WorkerRole] ?? 'general'
}

function RoleTag({ roleType, label }: { roleType: string; label: string }) {
  return <span className={`team-role-tag tone-${roleTone(roleType)}`}>{label}</span>
}

function WorkerStatusTag({
  worker,
  missingLabel,
  readyLabel,
  disabledLabel,
}: {
  worker: WorkerRegistration | undefined
  missingLabel: string
  readyLabel: string
  disabledLabel: string
}) {
  if (!worker) {
    return <span className="team-status-tag is-missing">{missingLabel}</span>
  }
  if (!worker.enabled) {
    return <span className="team-status-tag is-disabled">{disabledLabel}</span>
  }
  return <span className="team-status-tag is-ready">{readyLabel}</span>
}

function uniqueRoles(members: TeamTemplateMember[]): WorkerRole[] {
  const seen = new Set<WorkerRole>()
  for (const member of members) {
    if (ROLE_TONE[member.roleType as WorkerRole]) seen.add(member.roleType as WorkerRole)
  }
  return [...seen]
}

function cloneMembers(members: TeamTemplateMember[]): TeamTemplateMember[] {
  return members.map((member) => ({ ...member }))
}

function membersEqual(a: TeamTemplateMember[], b: TeamTemplateMember[]): boolean {
  if (a.length !== b.length) return false
  return a.every((member, index) => {
    const other = b[index]
    if (!other) return false
    return (
      member.name === other.name &&
      member.preferredWorkerId === other.preferredWorkerId &&
      member.roleType === other.roleType &&
      member.instructions === other.instructions &&
      (member.model ?? '') === (other.model ?? '') &&
      (member.reasoning ?? '') === (other.reasoning ?? '')
    )
  })
}

function templateReady(template: TeamTemplate, workers: WorkerRegistration[]): boolean {
  if (template.members.length === 0) return false
  return template.members.every((member) => {
    const worker = workerOf(workers, member.preferredWorkerId)
    return Boolean(worker?.enabled)
  })
}

/**
 * Global Team-template (编组) library: list, rename, describe, inspect members, delete.
 * Session apply / save-from-current stay in TeamTemplateManager (inspector).
 */
export function TeamTemplateLibrary({
  workers,
  projectId,
  initialTemplates,
  onChanged,
  focusTemplateId,
  className,
  layout = 'modal',
  hideRail = false,
}: TeamTemplateLibraryProps) {
  const { t } = useI18n()
  const { success, error } = useToast()
  const [templates, setTemplates] = useState<TeamTemplate[]>(initialTemplates ?? [])
  const [selectedId, setSelectedId] = useState(
    () => focusTemplateId ?? initialTemplates?.[0]?.id ?? '',
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [draftMembers, setDraftMembers] = useState<TeamTemplateMember[]>([])
  /** Expanded member indices for in-place edit; collapsed = view only. */
  const [expandedMembers, setExpandedMembers] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(!initialTemplates)
  const isSettings = layout === 'settings'

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [selectedId, templates],
  )

  const dirty = useMemo(() => {
    if (!selected) return false
    if (name.trim() !== selected.name) return true
    if ((description.trim() || '') !== (selected.description ?? '')) return true
    return !membersEqual(draftMembers, selected.members)
  }, [description, draftMembers, name, selected])

  const load = useCallback(async () => {
    const result = await api.listTeamTemplates()
    setTemplates(result.templates)
    setSelectedId((current) => {
      if (current && result.templates.some((template) => template.id === current)) return current
      if (focusTemplateId && result.templates.some((template) => template.id === focusTemplateId)) {
        return focusTemplateId
      }
      return result.templates[0]?.id ?? ''
    })
  }, [focusTemplateId])

  useEffect(() => {
    if (initialTemplates) setTemplates(initialTemplates)
  }, [initialTemplates])

  useEffect(() => {
    if (focusTemplateId) setSelectedId(focusTemplateId)
  }, [focusTemplateId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void load()
      .catch((cause) => {
        if (!cancelled) error(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [error, load])

  useEffect(() => {
    setName(selected?.name ?? '')
    setDescription(selected?.description ?? '')
    setDraftMembers(selected ? cloneMembers(selected.members) : [])
    setExpandedMembers(new Set())
  }, [selected])

  const enabledWorkers = useMemo(() => workers.filter((worker) => worker.enabled), [workers])

  const toggleMemberExpanded = (index: number) => {
    setExpandedMembers((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const patchMember = (index: number, patch: Partial<TeamTemplateMember>) => {
    setDraftMembers((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, ...patch } : member,
      ),
    )
  }

  const removeMember = (index: number) => {
    setDraftMembers((current) => current.filter((_, memberIndex) => memberIndex !== index))
    setExpandedMembers((current) => {
      const next = new Set<number>()
      for (const expanded of current) {
        if (expanded === index) continue
        next.add(expanded > index ? expanded - 1 : expanded)
      }
      return next
    })
  }

  const addMember = () => {
    const worker = enabledWorkers[0] ?? workers[0]
    if (!worker) return
    setDraftMembers((current) => {
      const next = [
        ...current,
        {
          name: worker.name,
          preferredWorkerId: worker.id,
          roleType: 'general' as WorkerRole,
          instructions: '',
        },
      ]
      setExpandedMembers(new Set([next.length - 1]))
      return next
    })
  }

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    try {
      await operation()
      onChanged?.()
    } catch (cause) {
      error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveTemplate = () =>
    run(async () => {
      if (!selected || !name.trim()) return
      const members = draftMembers
        .map((member) => ({
          name: member.name.trim(),
          preferredWorkerId: member.preferredWorkerId,
          roleType: member.roleType,
          instructions: member.instructions,
          ...(member.model?.trim() ? { model: member.model.trim() } : {}),
          ...(member.reasoning?.trim() ? { reasoning: member.reasoning.trim() } : {}),
        }))
        .filter((member) => member.name && member.preferredWorkerId)
      if (members.length === 0) {
        error(t('team.noMembers'))
        return
      }
      await api.updateTeamTemplate(selected.id, {
        name: name.trim(),
        description: description.trim() || null,
        members,
      })
      await load()
      success(t('team.updatedToast'))
    })

  const deleteSelected = () =>
    run(async () => {
      if (!selected) return
      await api.deleteTeamTemplate(selected.id)
      await load()
      success(t('team.deletedToast'))
    })

  const rail = (
    <aside
      className={isSettings ? 'settings-provider-rail' : 'team-library-list'}
      aria-label={t('team.savedTemplates')}
    >
      <div className={isSettings ? 'settings-rail-label' : 'team-library-list-head'}>
        {isSettings ? (
          t('team.savedTemplates')
        ) : (
          <>
            <span className="team-library-list-title">{t('team.savedTemplates')}</span>
            <span className="team-library-count-pill">{templates.length}</span>
          </>
        )}
      </div>

      {loading && templates.length === 0 && (
        <p className="team-library-empty">{t('app.loading')}</p>
      )}
      {!loading && templates.length === 0 && (
        <p className="team-library-empty">{t('team.libraryEmpty')}</p>
      )}

      {isSettings
        ? templates.map((template) => {
            const active = template.id === selectedId
            const ready = templateReady(template, workers)
            return (
              <button
                key={template.id}
                type="button"
                className={`settings-rail-item${active ? ' active' : ''}`}
                onClick={() => setSelectedId(template.id)}
              >
                <span className="settings-rail-text">
                  <span className="settings-rail-name">{template.name}</span>
                  <span className="settings-rail-badge">
                    {t('team.memberCount', { count: template.members.length })}
                  </span>
                </span>
                <span
                  className={`settings-rail-dot${ready ? ' on' : ''}`}
                  title={ready ? t('team.workerReady') : t('team.workerMissing')}
                />
              </button>
            )
          })
        : templates.map((template) => {
            const active = template.id === selectedId
            return (
              <button
                key={template.id}
                type="button"
                className={`team-library-item${active ? ' is-active' : ''}`}
                onClick={() => setSelectedId(template.id)}
              >
                <span className="team-library-item-body">
                  <span className="team-library-item-name">{template.name}</span>
                  <span className="team-library-item-meta">
                    {t('team.memberCount', { count: template.members.length })}
                  </span>
                </span>
              </button>
            )
          })}
    </aside>
  )

  const detail = (
    <section
      className={
        isSettings
          ? hideRail
            ? 'team-library-main team-library-main--embedded'
            : 'settings-model-main team-library-main'
          : 'team-library-detail'
      }
      aria-live="polite"
    >
      {!selected ? (
        <div className="team-library-detail-empty">
          <p>{t('team.libraryEmptyHint')}</p>
        </div>
      ) : (
        <>
          <div className="settings-provider-head team-library-provider-head">
            <div className="pname">{name.trim() || selected.name}</div>
            <span className="tag-on">{t('team.memberCount', { count: draftMembers.length })}</span>
            {uniqueRoles(draftMembers)
              .slice(0, 4)
              .map((role) => (
                <RoleTag key={role} roleType={role} label={t(roleMessageKey(role))} />
              ))}
            <span className="spacer" />
            <button
              type="button"
              className="settings-btn-soft is-danger"
              disabled={busy}
              onClick={() => void deleteSelected()}
            >
              {t('team.deleteTemplate')}
            </button>
            <button
              type="button"
              className="settings-save-btn"
              disabled={busy || !name.trim() || !dirty}
              onClick={() => void saveTemplate()}
            >
              {t('settings.save')}
            </button>
          </div>

          <div className="settings-field">
            <label htmlFor="team-library-name">{t('team.templateName')}</label>
            <input
              id="team-library-name"
              className="settings-input ui-font"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="team-library-desc">{t('team.templateDesc')}</label>
            <textarea
              id="team-library-desc"
              className="settings-input ui-font team-library-desc-input"
              rows={2}
              value={description}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('team.templateDesc')}
            />
            <span className="settings-field-hint">{t('team.libraryManageHint')}</span>
          </div>

          <section className="settings-section settings-model-section team-library-members-section">
            <div className="settings-section-head">
              <h3>{t('team.mappingSection')}</h3>
              <span className="settings-section-count">{draftMembers.length}</span>
            </div>

            {draftMembers.length === 0 ? (
              <p className="settings-muted settings-model-empty">{t('team.noMembers')}</p>
            ) : (
              <div className="settings-model-list">
                {draftMembers.map((member, index) => {
                  const worker = workerOf(workers, member.preferredWorkerId)
                  const expanded = expandedMembers.has(index)
                  const workerOptions =
                    worker && !enabledWorkers.some((item) => item.id === worker.id)
                      ? [worker, ...enabledWorkers]
                      : enabledWorkers.length > 0
                        ? enabledWorkers
                        : workers
                  const baseId = `team-member-${selected.id}-${index}`
                  return (
                    <div
                      className={`team-member-row${expanded ? ' is-expanded' : ' is-collapsed'}`}
                      key={`${selected.id}-${index}`}
                    >
                      <button
                        type="button"
                        className="team-member-summary"
                        aria-expanded={expanded}
                        onClick={() => toggleMemberExpanded(index)}
                      >
                        <span className="team-member-summary-main">
                          <span className="team-member-row-name">
                            {member.name.trim() || t('roles.name')}
                          </span>
                          <RoleTag
                            roleType={member.roleType}
                            label={t(roleMessageKey(member.roleType as WorkerRole))}
                          />
                          <WorkerStatusTag
                            worker={worker}
                            missingLabel={t('team.workerMissing')}
                            readyLabel={t('team.workerReady')}
                            disabledLabel={t('team.workerDisabled')}
                          />
                        </span>
                        <span className="team-member-summary-meta">
                          <span className="team-library-worker-chip">
                            <span
                              className={`worker-logo ${workerBrandClass(worker?.kind, worker?.name)}`}
                              aria-hidden
                            >
                              <WorkerBrandLogo
                                kind={worker?.kind}
                                name={worker?.name}
                                size={12}
                                workerId={worker?.id}
                                hasIcon={worker ? Boolean(worker.iconPath) : false}
                                iconAgentId={resolveWorkerIconAgentId(worker)}
                              />
                            </span>
                            <span>{worker?.name ?? member.preferredWorkerId}</span>
                          </span>
                          <span
                            className={`team-model-tag${member.model ? ' mono' : ' is-inherit'}`}
                          >
                            {member.model || t('team.inheritModel')}
                          </span>
                          <span
                            className={`team-member-chevron${expanded ? ' is-open' : ''}`}
                            aria-hidden
                          />
                        </span>
                      </button>

                      <Expandable open={!expanded && Boolean(member.instructions.trim())}>
                        <p className="team-member-summary-prompt">{member.instructions}</p>
                      </Expandable>

                      <Expandable open={expanded}>
                        <div className="team-member-edit">
                          <div className="team-member-edit-grid">
                            <label className="settings-field" htmlFor={`${baseId}-name`}>
                              <span>{t('roles.name')}</span>
                              <input
                                id={`${baseId}-name`}
                                className="settings-input ui-font"
                                value={member.name}
                                disabled={busy}
                                onChange={(event) =>
                                  patchMember(index, { name: event.target.value })
                                }
                              />
                            </label>
                            <label className="settings-field" htmlFor={`${baseId}-reasoning`}>
                              <span>{t('reasoning.intensity')}</span>
                              <WorkerReasoningSelect
                                id={`${baseId}-reasoning`}
                                workerId={member.preferredWorkerId}
                                model={member.model || worker?.model}
                                projectId={projectId}
                                value={member.reasoning ?? ''}
                                inheritLabel={t('reasoning.inheritWorker')}
                                disabled={busy}
                                onChange={(reasoning) =>
                                  patchMember(index, { reasoning: reasoning || undefined })
                                }
                              />
                            </label>
                            <label className="settings-field" htmlFor={`${baseId}-role`}>
                              <span>{t('roles.type')}</span>
                              <select
                                id={`${baseId}-role`}
                                className="settings-input ui-font"
                                value={member.roleType}
                                disabled={busy}
                                onChange={(event) =>
                                  patchMember(index, {
                                    roleType: event.target.value as WorkerRole,
                                  })
                                }
                              >
                                {WORKER_ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {t(roleMessageKey(role))}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="settings-field" htmlFor={`${baseId}-worker`}>
                              <span>{t('roles.worker')}</span>
                              <div
                                className={`team-member-worker-select${worker ? ' has-logo' : ''}`}
                              >
                                {worker ? (
                                  <span
                                    className={`worker-logo team-member-worker-logo ${workerBrandClass(worker.kind, worker.name)}`}
                                    aria-hidden
                                  >
                                    <WorkerBrandLogo
                                      kind={worker.kind}
                                      name={worker.name}
                                      size={14}
                                      workerId={worker.id}
                                      hasIcon={Boolean(worker.iconPath)}
                                      iconAgentId={resolveWorkerIconAgentId(worker)}
                                    />
                                  </span>
                                ) : null}
                                <select
                                  id={`${baseId}-worker`}
                                  className="settings-input ui-font"
                                  value={member.preferredWorkerId}
                                  disabled={busy}
                                  onChange={(event) => {
                                    const nextWorker = workerOf(workers, event.target.value)
                                    patchMember(index, {
                                      preferredWorkerId: event.target.value,
                                      ...(member.name.trim() === '' || member.name === worker?.name
                                        ? { name: nextWorker?.name ?? member.name }
                                        : {}),
                                    })
                                  }}
                                >
                                  {workerOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.name}
                                      {!option.enabled ? ` (${t('team.workerDisabled')})` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </label>
                            <label className="settings-field" htmlFor={`${baseId}-model`}>
                              <span>{t('roles.model')}</span>
                              <input
                                id={`${baseId}-model`}
                                className="settings-input mono"
                                value={member.model ?? ''}
                                disabled={busy}
                                placeholder={t('roles.modelInherit')}
                                onChange={(event) =>
                                  patchMember(index, {
                                    model: event.target.value || undefined,
                                  })
                                }
                              />
                            </label>
                          </div>

                          <label className="team-member-prompt-field" htmlFor={`${baseId}-prompt`}>
                            <span>{t('roles.instructions')}</span>
                            <textarea
                              id={`${baseId}-prompt`}
                              className="settings-input ui-font team-member-prompt-input"
                              rows={5}
                              value={member.instructions}
                              disabled={busy}
                              onChange={(event) =>
                                patchMember(index, { instructions: event.target.value })
                              }
                              placeholder={t('roles.instructions')}
                            />
                          </label>

                          <div className="team-member-edit-footer">
                            <button
                              type="button"
                              className="team-member-remove-link"
                              disabled={busy || draftMembers.length <= 1}
                              onClick={() => removeMember(index)}
                            >
                              {t('team.removeMember')}
                            </button>
                            <button
                              type="button"
                              className="settings-save-btn"
                              disabled={busy || !name.trim() || !dirty}
                              onClick={() => void saveTemplate()}
                            >
                              {t('settings.save')}
                            </button>
                          </div>
                        </div>
                      </Expandable>
                    </div>
                  )
                })}
              </div>
            )}

            <button
              type="button"
              className="team-member-add"
              disabled={busy || workers.length === 0}
              onClick={addMember}
            >
              {t('roles.add')}
            </button>
          </section>
        </>
      )}
    </section>
  )

  return (
    <div
      className={['team-library', isSettings ? 'is-settings' : 'is-modal', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {hideRail ? (
        detail
      ) : (
        <div
          className={
            isSettings
              ? 'settings-model-layout team-library-settings-layout'
              : 'team-library-layout'
          }
        >
          {rail}
          {detail}
        </div>
      )}
    </div>
  )
}
