/**
 * Composer-adjacent pending git changes.
 * Click a file → ChangedFilesDiffPanel (unified diff viewer).
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { IconFileEdit } from '../Icons'
import { useI18n } from '../../i18n/I18nProvider'
import { api, type GitStatusResponse } from '../../lib/api'
import { gitStatusLetter, splitDisplayPath } from '../../lib/composer-status-helpers'
import { ChangedFilesDiffPanel } from './ChangedFilesDiffPanel'

const popoverMotion = {
  initial: { opacity: 0, y: 8, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.98 },
  transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] as const },
}

const POLL_MS = 10_000

type Props = {
  projectId: string | null | undefined
  /** When false, skip polling (hidden keep-alive panes). */
  enabled?: boolean
  /** Bump or call after branch switch to force refresh. */
  refreshToken?: number
}

function PendingChangesBarImpl({ projectId, enabled = true, refreshToken = 0 }: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<GitStatusResponse | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerPath, setViewerPath] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const genRef = useRef(0)

  const load = useCallback(async () => {
    if (!projectId || !enabled) {
      setStatus(null)
      return
    }
    const gen = ++genRef.current
    try {
      const data = await api.gitStatus(projectId)
      if (gen !== genRef.current) return
      if (!data.ok || !data.isRepo) {
        setStatus(null)
        return
      }
      setStatus(data)
    } catch {
      if (gen !== genRef.current) return
      setStatus(null)
    }
  }, [projectId, enabled])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  useEffect(() => {
    if (!enabled || !projectId) return
    const id = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(id)
  }, [enabled, projectId, load])

  useEffect(() => {
    if (!expanded) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [expanded])

  const files = status?.files ?? []
  if (!status || files.length === 0) return null
  if (!projectId) return null

  const count = files.length
  const countLabel =
    count === 1
      ? t('chat.statusRow.pendingChanges.fileCountOne', { count: String(count) })
      : t('chat.statusRow.pendingChanges.fileCountMany', { count: String(count) })
  const insertions = status.insertions ?? 0
  const deletions = status.deletions ?? 0

  const openViewer = (path: string) => {
    setViewerPath(path)
    setViewerOpen(true)
    setExpanded(false)
  }

  return (
    <>
      <div className="pending-changes-bar" ref={rootRef}>
        <button
          type="button"
          className="pending-changes-trigger"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <IconFileEdit size={14} className="pending-changes-icon" />
          <span className="pending-changes-count">{countLabel}</span>
          <span className="pending-changes-label">
            {t('chat.statusRow.pendingChanges.changedInWorkspace')}
          </span>
          <span className="pending-changes-stats tabular">
            {insertions > 0 && <span className="is-add">+{insertions}</span>}
            {deletions > 0 && <span className="is-del">-{deletions}</span>}
          </span>
          <ChevronDown size={14} className="composer-status-chevron" aria-hidden />
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              key="pending-popover"
              className="composer-status-popover pending-changes-popover"
              role="dialog"
              {...popoverMotion}
            >
              <div className="composer-status-popover-head">
                <span>{t('chat.statusRow.pendingChanges.title')}</span>
                <span className="composer-status-popover-count tabular">{count}</span>
              </div>
              <div className="composer-status-popover-list">
                {files.map((file) => {
                  const { dirPart, fileName } = splitDisplayPath(file.path)
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className="pending-changes-file"
                      title={t('chat.diff.openFileTitle', { path: file.path })}
                      onClick={() => openViewer(file.path)}
                    >
                      <span className={`git-status-badge ${gitStatusLetter(file.status)}`}>
                        {gitStatusLetter(file.status)}
                      </span>
                      <span className="pending-changes-file-path" title={file.path}>
                        {dirPart ? (
                          <>
                            <span className="pending-changes-file-dir">{dirPart}</span>
                            {/* Slash lives outside the RTL dir box so it stays next to the name */}
                            <span className="pending-changes-file-sep">/</span>
                          </>
                        ) : null}
                        <span className="pending-changes-file-name">{fileName}</span>
                      </span>
                      <span className="pending-changes-file-stats tabular">
                        {(file.insertions ?? 0) > 0 && (
                          <span className="is-add">+{file.insertions}</span>
                        )}
                        {(file.deletions ?? 0) > 0 && (
                          <span className="is-del">-{file.deletions}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="pending-changes-popover-foot">
                <button
                  type="button"
                  className="pending-changes-view-all"
                  onClick={() => openViewer(files[0]!.path)}
                >
                  {t('chat.diff.viewAll')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ChangedFilesDiffPanel
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        projectId={projectId}
        files={files}
        initialPath={viewerPath}
      />
    </>
  )
}

export const PendingChangesBar = memo(PendingChangesBarImpl)
