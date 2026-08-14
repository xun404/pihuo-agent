import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGitBranches } from '../hooks/useGitBranches'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/locales'
import { useToast } from './Toast'
import { IconBranch, IconCheck, IconPlus } from './Icons'
import { ConfirmDialog, type ConfirmDialogConfig } from './ui/ConfirmDialog'
import type { BranchSwitchIssue, BranchSwitchIssueCode, BranchSwitchResult } from '../lib/api'
import type { Project, WorkerJob, WorkerRegistration } from '@pihuo-agent/shared'
import { isJobOpen } from '@pihuo-agent/shared'

interface Props {
  project: Project
  /** Workers registered to this project (for running-job warning). */
  snapshotWorkers: WorkerRegistration[]
  snapshotJobs: WorkerJob[]
  /** Called after a successful switch so parent can refresh git panels. */
  onAfterSwitch?: () => void
}

/**
 * Branch switcher for the composer context bar. Renders only when the project
 * is a real git repo. Popover lists local branches with search + create action;
 * switch to current is a no-op; switch blocked by dirty tracked files opens a
 * commit-and-switch assist dialog. Warns when project has open jobs first.
 */
export function BranchSwitcher({ project, snapshotWorkers, snapshotJobs, onAfterSwitch }: Props) {
  const { t } = useI18n()
  const { error: toastError, success: toastSuccess } = useToast()
  const git = useGitBranches({ projectId: project.id })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmDialogConfig | null>(null)
  const [commitAssist, setCommitAssist] = useState<{
    target: string
    issues: BranchSwitchIssue[]
  } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // close on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return git.branches
    return git.branches.filter((b) => b.name.toLowerCase().includes(q))
  }, [git.branches, query])

  // Not a repo → render nothing (caller still gets the project-name chip)
  if (!git.isRepo) return null

  const runningJobsForProject = snapshotJobs.filter((j) => {
    const w = snapshotWorkers.find((x) => x.id === j.workerId)
    return w?.projectId === project.id && isJobOpen(j.status)
  })

  const issueLocaleKey = (code: BranchSwitchIssueCode | undefined): MessageKey => {
    const key = code
      ? `git.branchSwitcher.error.${code}`
      : 'git.branchSwitcher.error.request-failed'
    return key as MessageKey
  }

  const performSwitch = async (name: string) => {
    const r = await git.switchTo(name)
    if (r.ok) {
      setOpen(false)
      toastSuccess(t('git.branchSwitcher.toast.switchSuccess', { branchName: name }))
      onAfterSwitch?.()
    } else {
      const issue = r.issues[0]
      if (issue && issue.code === 'tracked-changes-would-be-overwritten') {
        setOpen(false)
        setCommitAssist({ target: name, issues: r.issues })
      } else {
        toastError(t(issueLocaleKey(issue?.code)))
      }
    }
  }

  const onPick = async (name: string) => {
    if (name === git.currentBranchName) {
      setOpen(false)
      return
    }
    if (runningJobsForProject.length > 0) {
      setPendingConfirm({
        title: t('git.branchSwitcher.title'),
        message: t('git.branchSwitcher.workerWarning', {
          count: runningJobsForProject.length,
        }),
        confirmLabel: t('common.confirm'),
        cancelLabel: t('common.cancel'),
        onConfirm: async () => {
          await performSwitch(name)
        },
      })
      return
    }
    await performSwitch(name)
  }

  const triggerLabel = git.loading
    ? t('git.branchSwitcher.loading')
    : (git.currentBranchName ?? t('git.branchSwitcher.detached'))

  return (
    <div className="ctx branch-switcher" ref={wrapRef}>
      <button
        type="button"
        className="branch-trigger"
        onClick={() =>
          setOpen((v) => {
            if (!v) setQuery('')
            return !v
          })
        }
        disabled={git.mutationPending}
        title={t('git.branchSwitcher.trigger.ariaLabel')}
      >
        <IconBranch size={13} />
        <span className="branch-label">{triggerLabel}</span>
        {git.loading || git.mutationPending ? (
          <span className="branch-spinner" aria-label="loading" />
        ) : (
          <span className="caret">▾</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="pop-menu branch-menu"
            role="menu"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
          >
            <input
              className="branch-search"
              placeholder={t('git.branchSwitcher.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div
              className="branch-list"
              role="group"
              aria-label={t('git.branchSwitcher.section.branches')}
            >
              {git.loading && <div className="branch-empty">{t('common.loading')}</div>}
              {!git.loading && filtered.length === 0 && (
                <div className="branch-empty">{t('git.branchSwitcher.empty')}</div>
              )}
              {filtered.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  className={`pop-item branch-item${b.isCurrent ? ' on' : ''}`}
                  role="menuitem"
                  disabled={git.mutationPending}
                  onClick={() => void onPick(b.name)}
                >
                  <IconBranch size={14} />
                  <span className="branch-name">{b.name}</span>
                  {b.isCurrent && git.dirtyFileCount > 0 && (
                    <span className="branch-dirty">
                      {t('git.branchSwitcher.currentDirty', { count: git.dirtyFileCount })}
                    </span>
                  )}
                  {b.isCurrent && <IconCheck size={13} />}
                </button>
              ))}
            </div>
            <div className="branch-footer">
              <button
                type="button"
                className="pop-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  setCreateOpen(true)
                }}
              >
                <IconPlus size={14} />
                {t('git.branchSwitcher.createAction')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CreateBranchDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, startPoint) => {
          const r = await git.createAndSwitch(name, startPoint)
          if (r.ok) {
            setCreateOpen(false)
            toastSuccess(t('git.branchSwitcher.toast.createSuccess', { branchName: name }))
            onAfterSwitch?.()
          } else {
            toastError(t(issueLocaleKey(r.issues[0]?.code)))
          }
        }}
        validating={git.mutationPending}
      />

      <CommitAndSwitchDialog
        open={!!commitAssist}
        target={commitAssist?.target ?? ''}
        issues={commitAssist?.issues ?? []}
        onClose={() => setCommitAssist(null)}
        onCommit={async (message) => {
          if (!commitAssist) return
          const r: BranchSwitchResult = await git.commitAndSwitch(commitAssist.target, message)
          if (r.ok) {
            setCommitAssist(null)
            toastSuccess(
              t('git.branchSwitcher.toast.switchSuccess', { branchName: commitAssist.target }),
            )
            onAfterSwitch?.()
          } else {
            toastError(t(issueLocaleKey(r.issues[0]?.code)))
          }
        }}
        validating={git.mutationPending}
      />

      <ConfirmDialog
        open={!!pendingConfirm}
        config={pendingConfirm}
        onClose={() => setPendingConfirm(null)}
      />
    </div>
  )
}

/** Inline "Create new branch" dialog. */
function CreateBranchDialog({
  open,
  onClose,
  onCreate,
  validating,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string, startPoint?: string) => void
  validating: boolean
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [startPoint, setStartPoint] = useState('')
  useEffect(() => {
    if (open) {
      setName('')
      setStartPoint('')
    }
  }, [open])
  if (!open) return null
  return (
    <div className="branch-dialog-overlay" role="dialog" aria-modal="true">
      <div className="branch-dialog">
        <h4>{t('git.branchSwitcher.createDialog.title')}</h4>
        <p className="settings-field-hint">{t('git.branchSwitcher.createDialog.description')}</p>
        <label className="settings-field">
          <span>{t('git.branchSwitcher.createDialog.nameLabel')}</span>
          <input
            className="settings-input mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('git.branchSwitcher.createDialog.placeholder')}
            autoFocus
          />
        </label>
        <label className="settings-field">
          <span>{t('git.branchSwitcher.createDialog.startPointLabel')}</span>
          <input
            className="settings-input mono"
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
            placeholder={t('git.branchSwitcher.createDialog.startPointPlaceholder')}
          />
        </label>
        <div className="text-prompt-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={validating}>
            {t('prompt.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || validating}
            onClick={() => onCreate(name.trim(), startPoint.trim() || undefined)}
          >
            {t('git.branchSwitcher.createDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Commit-and-switch assist: shown when switch is blocked by tracked dirty files. */
function CommitAndSwitchDialog({
  open,
  target,
  issues,
  onClose,
  onCommit,
  validating,
}: {
  open: boolean
  target: string
  issues: BranchSwitchIssue[]
  onClose: () => void
  onCommit: (message: string) => void
  validating: boolean
}) {
  const { t } = useI18n()
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (open) setMessage(`chore: before switch to ${target}`)
  }, [open, target])
  if (!open) return null
  const blockedPaths = issues.flatMap((i) => i.paths ?? [])
  return (
    <div className="branch-dialog-overlay" role="dialog" aria-modal="true">
      <div className="branch-dialog">
        <h4>{t('git.branchSwitcher.commitDialog.title')}</h4>
        <p className="settings-field-hint">
          {t('git.branchSwitcher.commitDialog.description', { target })}
        </p>
        {blockedPaths.length > 0 && (
          <div className="branch-blocked-files">
            {blockedPaths.slice(0, 20).map((p) => (
              <div key={p} className="mono">
                {p}
              </div>
            ))}
            {blockedPaths.length > 20 && <div>… +{blockedPaths.length - 20}</div>}
          </div>
        )}
        <label className="settings-field">
          <span>{t('git.branchSwitcher.commitDialog.messageLabel')}</span>
          <input
            className="settings-input mono"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            autoFocus
          />
        </label>
        <div className="text-prompt-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={validating}>
            {t('prompt.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!message.trim() || validating}
            onClick={() => onCommit(message.trim())}
          >
            {t('git.branchSwitcher.commitDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
