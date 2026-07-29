import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  TeamMember,
  TeamTemplate,
  TeamTemplateApplicationPreview,
  TeamTemplateMemberMapping,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { api } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { Modal } from './ui/Modal'
import { useToast } from './Toast'
import { WorkerReasoningSelect } from './WorkerReasoningSelect'

interface Props {
  sessionId: string | null | undefined
  teamMembers: TeamMember[]
  workers: WorkerRegistration[]
  projectId?: string | null
  openJobCount: number
  onApplied: () => void
}

function templateMembers(teamMembers: TeamMember[]) {
  return teamMembers.map((member) => ({
    preferredWorkerId: member.workerId,
    name: member.name,
    roleType: member.roleType,
    instructions: member.instructions,
    model: member.model,
    reasoning: member.reasoning,
  }))
}

export function TeamTemplateManager({
  sessionId,
  teamMembers,
  workers,
  projectId,
  openJobCount,
  onApplied,
}: Props) {
  const { t } = useI18n()
  const { success, error } = useToast()
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<TeamTemplate[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [preview, setPreview] = useState<TeamTemplateApplicationPreview | null>(null)
  const [mappings, setMappings] = useState<TeamTemplateMemberMapping[]>([])
  const [busy, setBusy] = useState(false)
  const selected = templates.find((template) => template.id === selectedId)
  const enabledWorkers = useMemo(() => workers.filter((worker) => worker.enabled), [workers])

  const load = useCallback(async () => {
    const result = await api.listTeamTemplates()
    setTemplates(result.templates)
    setSelectedId((current) =>
      result.templates.some((template) => template.id === current)
        ? current
        : (result.templates[0]?.id ?? ''),
    )
  }, [])

  useEffect(() => {
    if (!open) return
    void load().catch((cause) => error(cause instanceof Error ? cause.message : String(cause)))
  }, [error, load, open])

  useEffect(() => {
    setName(selected?.name ?? '')
    setDescription(selected?.description ?? '')
    setMappings([])
    setPreview(null)
  }, [selected?.description, selected?.name, selectedId])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    try {
      await operation()
    } catch (cause) {
      error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveNew = () =>
    run(async () => {
      if (!name.trim() || teamMembers.length === 0) return
      const result = await api.createTeamTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
        members: templateMembers(teamMembers),
      })
      await load()
      setSelectedId(result.template.id)
      success(t('team.savedToast'))
    })

  const updateSelected = (overwriteMembers: boolean) =>
    run(async () => {
      if (!selected || !name.trim()) return
      await api.updateTeamTemplate(selected.id, {
        name: name.trim(),
        description: description.trim() || null,
        ...(overwriteMembers ? { members: templateMembers(teamMembers) } : {}),
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

  const refreshPreview = (nextMappings = mappings) =>
    run(async () => {
      if (!sessionId || !selected) return
      setPreview(await api.previewTeamTemplateApplication(sessionId, selected.id, nextMappings))
    })

  const setWorkerMapping = (memberIndex: number, workerId: string) => {
    const next = [
      ...mappings.filter((mapping) => mapping.memberIndex !== memberIndex),
      { memberIndex, workerId, model: null, reasoning: null },
    ]
    setMappings(next)
  }

  const setModelMapping = (memberIndex: number, model: string) => {
    const existing = mappings.find((mapping) => mapping.memberIndex === memberIndex)
    const member = preview?.members.find((candidate) => candidate.memberIndex === memberIndex)
    const workerId = existing?.workerId ?? member?.workerId
    if (!workerId) return
    setMappings([
      ...mappings.filter((mapping) => mapping.memberIndex !== memberIndex),
      {
        ...existing,
        memberIndex,
        workerId,
        model: model.trim() || null,
      },
    ])
  }

  const setReasoningMapping = (memberIndex: number, reasoning: string) => {
    const existing = mappings.find((mapping) => mapping.memberIndex === memberIndex)
    const member = preview?.members.find((candidate) => candidate.memberIndex === memberIndex)
    const workerId = existing?.workerId ?? member?.workerId
    if (!workerId) return
    setMappings([
      ...mappings.filter((mapping) => mapping.memberIndex !== memberIndex),
      {
        ...existing,
        memberIndex,
        workerId,
        reasoning: reasoning.trim() || null,
      },
    ])
  }

  const apply = () =>
    run(async () => {
      if (!sessionId || !selected) return
      const currentPreview =
        preview ?? (await api.previewTeamTemplateApplication(sessionId, selected.id, mappings))
      setPreview(currentPreview)
      if (!currentPreview.ready) return
      await api.applyTeamTemplate(sessionId, {
        templateId: selected.id,
        expectedTeamRevision: currentPreview.teamRevision,
        mappings,
      })
      setOpen(false)
      onApplied()
      success(t('team.replacedToast'))
    })

  return (
    <>
      <button
        className="settings-btn-soft team-template-trigger"
        type="button"
        disabled={!sessionId}
        onClick={() => setOpen(true)}
      >
        {t('team.templates')}
      </button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        label={t('team.templates')}
        panelClassName="text-prompt-modal team-template-modal"
        closeOnBackdrop={!busy}
        closeOnEsc={!busy}
      >
        <h2>{t('team.templates')}</h2>
        <p className="team-template-hint">{t('team.templatesHint')}</p>

        <section className="team-template-section">
          <div className="team-template-field">
            <label htmlFor="team-template-select">{t('team.savedTemplates')}</label>
            <select
              id="team-template-select"
              className="settings-select"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">{t('team.newTemplate')}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <div className="team-template-field">
            <label htmlFor="team-template-name">{t('team.templateName')}</label>
            <input
              id="team-template-name"
              className="settings-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="team-template-field">
            <label htmlFor="team-template-description">{t('team.templateDesc')}</label>
            <input
              id="team-template-description"
              className="settings-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </section>

        <div className="team-template-actions">
          {!selected && (
            <button
              className="settings-save-btn"
              type="button"
              disabled={busy || !name.trim() || teamMembers.length === 0}
              onClick={saveNew}
            >
              {t('team.saveCurrent')}
            </button>
          )}
          {selected && (
            <>
              <button
                className="settings-btn-soft"
                type="button"
                disabled={busy}
                onClick={deleteSelected}
              >
                {t('team.deleteTemplate')}
              </button>
              <button
                className="settings-btn-soft"
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => updateSelected(false)}
              >
                {t('team.saveMeta')}
              </button>
              <button
                className="settings-btn-soft"
                type="button"
                disabled={busy || teamMembers.length === 0}
                onClick={() => updateSelected(true)}
              >
                {t('team.overwriteFromCurrent')}
              </button>
              <button
                className="settings-btn-soft"
                type="button"
                disabled={busy || openJobCount > 0}
                onClick={() => void refreshPreview()}
              >
                {t('team.checkMappings')}
              </button>
            </>
          )}
        </div>

        {openJobCount > 0 && (
          <p className="team-template-warn">{t('team.openJobsBlock', { count: openJobCount })}</p>
        )}

        {preview && preview.members.length > 0 && (
          <section className="team-template-section team-template-mapping">
            <div className="team-template-section-title">{t('team.mappingSection')}</div>
            <div className="team-mapping-list">
              {preview.members.map((member) => {
                const mapping = mappings.find(
                  (candidate) => candidate.memberIndex === member.memberIndex,
                )
                const workerId = mapping?.workerId ?? member.workerId ?? ''
                const mappedModel =
                  mapping && Object.prototype.hasOwnProperty.call(mapping, 'model')
                    ? (mapping.model ?? '')
                    : (member.model ?? '')
                const mappedReasoning =
                  mapping && Object.prototype.hasOwnProperty.call(mapping, 'reasoning')
                    ? (mapping.reasoning ?? '')
                    : (member.reasoning ?? '')
                return (
                  <article className="team-mapping-card" key={member.memberIndex}>
                    <div className="team-mapping-head">
                      <span className="team-mapping-name">{member.name}</span>
                      <span className="team-mapping-type">{member.roleType}</span>
                    </div>
                    <p className="team-mapping-prompt">{member.instructions}</p>
                    {member.issueCode ? (
                      <div className="team-mapping-controls">
                        <select
                          className="settings-select"
                          value={workerId}
                          onChange={(event) =>
                            setWorkerMapping(member.memberIndex, event.target.value)
                          }
                        >
                          <option value="">{t('team.chooseWorker')}</option>
                          {enabledWorkers.map((worker) => (
                            <option key={worker.id} value={worker.id}>
                              {worker.name}
                            </option>
                          ))}
                        </select>
                        <input
                          className="settings-input"
                          value={mappedModel}
                          disabled={!workerId}
                          placeholder={t('team.modelPlaceholder')}
                          onChange={(event) =>
                            setModelMapping(member.memberIndex, event.target.value)
                          }
                          onBlur={() => void refreshPreview()}
                        />
                        <WorkerReasoningSelect
                          id={`team-template-reasoning-${member.memberIndex}`}
                          workerId={workerId}
                          model={
                            mappedModel || workers.find((worker) => worker.id === workerId)?.model
                          }
                          projectId={projectId}
                          value={mappedReasoning}
                          inheritLabel={t('reasoning.inheritWorker')}
                          disabled={!workerId || busy}
                          onChange={(reasoning) =>
                            setReasoningMapping(member.memberIndex, reasoning)
                          }
                        />
                      </div>
                    ) : (
                      <div className="team-mapping-meta">
                        <span>
                          {workers.find((worker) => worker.id === member.workerId)?.name ??
                            member.workerId}
                        </span>
                        <span className="team-mapping-dot" aria-hidden>
                          ·
                        </span>
                        <span>{mappedModel || t('team.inheritModel')}</span>
                        <span className="team-mapping-dot" aria-hidden>
                          ·
                        </span>
                        <span>{mappedReasoning || t('reasoning.inheritWorker')}</span>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        )}

        <div className="team-template-footer">
          <button
            className="settings-btn-soft"
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {t('team.close')}
          </button>
          {selected && (
            <button
              className="settings-save-btn"
              type="button"
              disabled={busy || openJobCount > 0 || (preview !== null && !preview.ready)}
              onClick={apply}
            >
              {t('team.replaceCurrent')}
            </button>
          )}
        </div>
      </Modal>
    </>
  )
}
