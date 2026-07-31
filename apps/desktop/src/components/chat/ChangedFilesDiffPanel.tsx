/**
 * OpenChamber-style stacked changed-files viewer:
 * - Scope: 已更改 / 已暂存 / 上一轮
 * - Expandable per-file rows + expand/collapse all
 * - Unified / side-by-side, wrap, full-file context
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileText,
  ListCollapse,
  ListTree,
  TextWrap,
  X,
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useI18n } from '../../i18n/I18nProvider'
import { api, type GitStatusResponse } from '../../lib/api'
import { gitStatusLetter, splitDisplayPath } from '../../lib/composer-status-helpers'
import {
  countScopes,
  filterFilesByScope,
  type DiffFileScope,
  type GitFileRow,
} from '../../lib/git-file-scope'
import { parseUnifiedDiff, toSideBySideRows } from '../../lib/parse-unified-diff'
import { DiffCode } from './DiffCode'

type FileRow = GitStatusResponse['files'][number]
type DiffLayout = 'unified' | 'side-by-side'

const DEFAULT_CONTEXT = 3
const FULL_FILE_CONTEXT = 1_000_000
/** Wait past CSS grid expand (0.2s) so scroll metrics are final. */
const SCROLL_CENTER_DELAY_MS = 240

type Props = {
  open: boolean
  onClose: () => void
  projectId: string
  files: FileRow[]
  initialPath?: string | null
}

type FileDiffState = {
  loading: boolean
  error: string | null
  patch: string
  isBinary: boolean
  insertions: number
  deletions: number
}

/**
 * Center a change row inside `.diff-file-block-body-inner`.
 * `scrollIntoView` often scrolls the wrong ancestor (modal / stacked list).
 * Near EOF we scroll as far as content allows — no fake bottom padding.
 */
function scrollChangeIntoCenter(el: HTMLElement, behavior: ScrollBehavior = 'smooth') {
  const scroller = el.closest('.diff-file-block-body-inner') as HTMLElement | null
  if (!scroller) {
    el.scrollIntoView({ block: 'center', behavior })
    return
  }

  const half = scroller.clientHeight / 2
  const elRect = el.getBoundingClientRect()
  const scRect = scroller.getBoundingClientRect()
  const elTopInContent = elRect.top - scRect.top + scroller.scrollTop
  const target = elTopInContent - half + elRect.height / 2
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  scroller.scrollTo({
    top: Math.max(0, Math.min(maxScroll, target)),
    behavior,
  })
}

function DiffBody({
  patch,
  filePath,
  layout,
  wrap,
  fullFile,
  onFirstChangeReady,
}: {
  patch: string
  filePath: string
  layout: DiffLayout
  wrap: boolean
  fullFile: boolean
  onFirstChangeReady?: (el: HTMLElement | null) => void
}) {
  // Drop raw git headers (diff --git / index / --- / +++) — keep hunk + body only.
  const lines = useMemo(
    () => parseUnifiedDiff(patch).filter((l) => l.kind !== 'meta' && l.kind !== 'other'),
    [patch],
  )
  const sideRows = useMemo(() => toSideBySideRows(lines), [lines])
  const wrapClass = wrap ? ' is-wrap' : ' is-nowrap'
  const fullClass = fullFile ? ' is-full' : ''
  const firstChangeRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // Callback refs settle before paint; wait 2 frames so layout/height settle.
    let cancelled = false
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) onFirstChangeReady?.(firstChangeRef.current)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [patch, layout, fullFile, onFirstChangeReady])

  let markedFirst = false
  const mark = (isChange: boolean) => {
    if (!isChange || markedFirst) return undefined
    markedFirst = true
    return (el: HTMLDivElement | null) => {
      firstChangeRef.current = el
    }
  }

  if (layout === 'unified') {
    return (
      <pre className={`unified-diff${wrapClass}${fullClass}`}>
        {lines.map((line, i) => {
          const isChange = line.kind === 'add' || line.kind === 'del'
          // Hunk headers: full-width, no gutter/sign chrome
          if (line.kind === 'hunk') {
            return (
              <div key={i} className="unified-diff-line is-hunk">
                <span className="unified-diff-code">{line.content}</span>
              </div>
            )
          }
          return (
            <div
              key={i}
              ref={mark(isChange)}
              className={`unified-diff-line is-${line.kind}`}
              data-diff-change={isChange ? '1' : undefined}
            >
              <span className="unified-diff-gutter old tabular">{line.oldNo ?? ''}</span>
              <span className="unified-diff-gutter new tabular">{line.newNo ?? ''}</span>
              <span className="unified-diff-sign" aria-hidden>
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : line.kind === 'ctx' ? ' ' : ''}
              </span>
              {line.kind === 'add' || line.kind === 'del' || line.kind === 'ctx' ? (
                <DiffCode className="unified-diff-code" code={line.content} filePath={filePath} />
              ) : (
                <span className="unified-diff-code">{line.content}</span>
              )}
            </div>
          )
        })}
      </pre>
    )
  }

  return (
    <div className={`side-diff${wrapClass}${fullClass}`}>
      {sideRows.map((row, i) => {
        if (row.full) {
          if (row.full.kind !== 'hunk') return null
          return (
            <div key={i} className={`side-diff-full is-${row.full.kind}`}>
              {row.full.content}
            </div>
          )
        }
        const isChange =
          row.left.kind === 'del' ||
          row.left.kind === 'add' ||
          row.right.kind === 'del' ||
          row.right.kind === 'add'
        return (
          <div
            key={i}
            ref={mark(isChange)}
            className="side-diff-row"
            data-diff-change={isChange ? '1' : undefined}
          >
            <div className={`side-diff-cell is-${row.left.kind}`}>
              <span className="side-diff-gutter tabular">{row.left.no ?? ''}</span>
              <DiffCode
                className="side-diff-code"
                code={row.left.content}
                filePath={filePath}
                title={row.left.content || undefined}
              />
            </div>
            <div className={`side-diff-cell is-${row.right.kind}`}>
              <span className="side-diff-gutter tabular">{row.right.no ?? ''}</span>
              <DiffCode
                className="side-diff-code"
                code={row.right.content}
                filePath={filePath}
                title={row.right.content || undefined}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FileDiffBlock({
  file,
  projectId,
  expanded,
  onToggle,
  stagedScope,
  layout,
  wrap,
  fullFile,
}: {
  file: GitFileRow
  projectId: string
  expanded: boolean
  onToggle: () => void
  stagedScope: boolean
  layout: DiffLayout
  wrap: boolean
  fullFile: boolean
}) {
  const { t } = useI18n()
  const [state, setState] = useState<FileDiffState>({
    loading: false,
    error: null,
    patch: '',
    isBinary: false,
    insertions: file.insertions ?? 0,
    deletions: file.deletions ?? 0,
  })
  const loadedKey = useRef<string | null>(null)
  const fetchGen = useRef(0)
  const scrollTimerRef = useRef<number | null>(null)
  // Re-center when the same file is re-expanded or full-file reloads.
  const lastScrollKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!expanded) return
    const key = `${file.path}|${stagedScope ? 1 : 0}|${fullFile ? 1 : 0}`
    if (loadedKey.current === key && state.patch) return

    const gen = ++fetchGen.current
    setState((s) => ({ ...s, loading: true, error: null }))
    void (async () => {
      try {
        const res = await api.gitFileDiff(projectId, file.path, {
          staged: stagedScope,
          contextLines: fullFile ? FULL_FILE_CONTEXT : DEFAULT_CONTEXT,
        })
        if (gen !== fetchGen.current) return
        if (!res.ok) {
          setState((s) => ({
            ...s,
            loading: false,
            error: res.error ?? t('chat.diff.loadFailed'),
            patch: '',
          }))
          return
        }
        loadedKey.current = key
        setState({
          loading: false,
          error: null,
          patch: res.patch,
          isBinary: res.isBinary,
          insertions: res.insertions || file.insertions || 0,
          deletions: res.deletions || file.deletions || 0,
        })
      } catch (e) {
        if (gen !== fetchGen.current) return
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : t('chat.diff.loadFailed'),
          patch: '',
        }))
      }
    })()
    return () => {
      // invalidate in-flight when deps change / unmount
      fetchGen.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when expand/key inputs change
  }, [expanded, file.path, stagedScope, fullFile, projectId, t])

  // Drop cached patch when scope/full changes so next expand reloads
  useEffect(() => {
    loadedKey.current = null
  }, [stagedScope, fullFile, file.path])

  const { dirPart, fileName } = splitDisplayPath(file.path)
  const ins = state.insertions || file.insertions || 0
  const del = state.deletions || file.deletions || 0

  // Clear pending center-scroll when collapsed
  useEffect(() => {
    if (expanded) return
    if (scrollTimerRef.current != null) {
      window.clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = null
    }
    lastScrollKeyRef.current = null
  }, [expanded])

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current != null) window.clearTimeout(scrollTimerRef.current)
    }
  }, [])

  const onFirstChangeReady = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !expanded) return
      // Key by path + full-file so re-open / full toggle re-centers once.
      const key = `${file.path}|${fullFile ? 1 : 0}|${state.patch.length}`
      if (lastScrollKeyRef.current === key) return
      lastScrollKeyRef.current = key
      if (scrollTimerRef.current != null) window.clearTimeout(scrollTimerRef.current)
      // After expand animation + layout: center first change in body scroller.
      scrollTimerRef.current = window.setTimeout(() => {
        scrollTimerRef.current = null
        scrollChangeIntoCenter(el, 'smooth')
      }, SCROLL_CENTER_DELAY_MS)
    },
    [expanded, file.path, fullFile, state.patch.length],
  )

  return (
    <div className={`diff-file-block${expanded ? ' is-open' : ''}`} data-path={file.path}>
      <button
        type="button"
        className="diff-file-block-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="diff-file-block-chevron" aria-hidden>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className={`git-status-badge ${gitStatusLetter(file.status)}`}>
          {gitStatusLetter(file.status)}
        </span>
        <span className="diff-file-block-path" title={file.path}>
          {dirPart ? (
            <>
              <span className="diff-file-block-dir">{dirPart}</span>
              <span className="diff-file-block-sep">/</span>
            </>
          ) : null}
          <span className="diff-file-block-name">{fileName}</span>
        </span>
        <span className="diff-file-block-stats tabular">
          {ins > 0 && <span className="is-add">+{ins}</span>}
          {del > 0 && <span className="is-del">-{del}</span>}
        </span>
      </button>

      {/* CSS grid expand — avoids framer height:auto glitches that mis-associate bodies */}
      <div className={`diff-file-block-body${expanded ? ' is-open' : ''}`} aria-hidden={!expanded}>
        <div className="diff-file-block-body-inner">
          {expanded && state.loading && <p className="section-hint">{t('common.loading')}</p>}
          {expanded && !state.loading && state.error && (
            <p className="section-hint is-warn">{state.error}</p>
          )}
          {expanded && !state.loading && !state.error && state.isBinary && (
            <p className="section-hint">{t('chat.diff.binary')}</p>
          )}
          {expanded && !state.loading && !state.error && !state.isBinary && !state.patch && (
            <p className="section-hint">{t('chat.diff.empty')}</p>
          )}
          {expanded && !state.loading && !state.error && !state.isBinary && state.patch && (
            <DiffBody
              patch={state.patch}
              filePath={file.path}
              layout={layout}
              wrap={wrap}
              fullFile={fullFile}
              onFirstChangeReady={onFirstChangeReady}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function ChangedFilesDiffPanel({ open, onClose, projectId, files }: Props) {
  const { t } = useI18n()
  const [scope, setScope] = useState<DiffFileScope>('working')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [layout, setLayout] = useState<DiffLayout>('unified')
  const [wrap, setWrap] = useState(false)
  const [fullFile, setFullFile] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scopeMenuRef = useRef<HTMLDivElement>(null)

  const allFiles = files as GitFileRow[]
  // Stable path signature — parent re-polls status and creates new array refs often.
  const filesSig = useMemo(
    () => allFiles.map((f) => f.path).join('\n'),
    [allFiles],
  )
  const counts = useMemo(() => countScopes(allFiles), [allFiles])
  const visibleFiles = useMemo(
    () => filterFilesByScope(allFiles, scope),
    [allFiles, scope],
  )

  const wasOpenRef = useRef(false)
  const prevScopeRef = useRef(scope)

  // Every open: reset to defaults (no wrap, unified, not full-file, all collapsed).
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (!justOpened) return
    setScope('working')
    prevScopeRef.current = 'working'
    setLayout('unified')
    setWrap(false)
    setFullFile(false)
    setExpanded(new Set())
    setScopeOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open edge
  }, [open])

  // Scope switch: collapse all (user expands what they need).
  useEffect(() => {
    if (!open) return
    if (prevScopeRef.current === scope) return
    prevScopeRef.current = scope
    setExpanded(new Set())
  }, [scope, open])

  // Drop expand keys for paths that disappeared from the list (don't reset others).
  useEffect(() => {
    if (!open) return
    const valid = new Set(visibleFiles.map((f) => f.path))
    setExpanded((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const p of prev) {
        if (valid.has(p)) next.add(p)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [filesSig, open, visibleFiles])

  useEffect(() => {
    if (!scopeOpen) return
    const onDown = (e: MouseEvent) => {
      if (!scopeMenuRef.current?.contains(e.target as Node)) setScopeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [scopeOpen])

  const toggleFile = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const expandAll = () => setExpanded(new Set(visibleFiles.map((f) => f.path)))
  const collapseAll = () => setExpanded(new Set())
  const anyExpanded = expanded.size > 0

  const scopeLabel =
    scope === 'staged'
      ? t('chat.diff.scope.staged')
      : scope === 'turn'
        ? t('chat.diff.scope.turn')
        : t('chat.diff.scope.working')
  const scopeCount =
    scope === 'staged' ? counts.staged : scope === 'turn' ? counts.turn : counts.working
  const stagedScope = scope === 'staged'

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={t('chat.diff.title')}
      panelClassName="changed-files-diff-modal is-stacked"
    >
      <div className="changed-files-diff is-stacked">
        <header className="changed-files-diff-head stacked-head">
          <div className="stacked-head-left" ref={scopeMenuRef}>
            <button
              type="button"
              className="diff-scope-trigger"
              aria-expanded={scopeOpen}
              onClick={() => setScopeOpen((v) => !v)}
            >
              <span>
                {scopeLabel}
                <span className="diff-scope-count">: {scopeCount}</span>
              </span>
              <ChevronDown size={14} className={scopeOpen ? 'is-open' : ''} />
            </button>
            {scopeOpen && (
              <div className="diff-scope-menu" role="listbox">
                {(
                  [
                    { id: 'working' as const, label: t('chat.diff.scope.working'), n: counts.working },
                    { id: 'staged' as const, label: t('chat.diff.scope.staged'), n: counts.staged },
                    { id: 'turn' as const, label: t('chat.diff.scope.turn'), n: counts.turn },
                  ] as const
                ).map((opt) => {
                  const disabled = opt.id === 'turn'
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={scope === opt.id}
                      disabled={disabled}
                      className={`diff-scope-option${scope === opt.id ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
                      onClick={() => {
                        if (disabled) return
                        setScope(opt.id)
                        setScopeOpen(false)
                      }}
                      title={
                        disabled ? t('chat.diff.scope.turnHint') : undefined
                      }
                    >
                      <span>{opt.label}</span>
                      <span className="diff-scope-option-count">{opt.n}</span>
                      {scope === opt.id && <Check size={14} className="diff-scope-check" />}
                    </button>
                  )
                })}
              </div>
            )}

            {visibleFiles.length > 0 && (
              <button
                type="button"
                className="diff-tool-btn"
                onClick={() => (anyExpanded ? collapseAll() : expandAll())}
                title={anyExpanded ? t('chat.diff.collapseAll') : t('chat.diff.expandAll')}
              >
                {anyExpanded ? <ListCollapse size={14} /> : <ListTree size={14} />}
                <span>
                  {anyExpanded ? t('chat.diff.collapseAll') : t('chat.diff.expandAll')}
                </span>
              </button>
            )}
          </div>

          <div className="changed-files-diff-toolbar">
            <button
              type="button"
              className={`diff-tool-btn${wrap ? ' is-on' : ''}`}
              title={t('chat.diff.wrap')}
              aria-pressed={wrap}
              onClick={() => setWrap((v) => !v)}
            >
              <TextWrap size={14} />
              <span>{t('chat.diff.wrapShort')}</span>
            </button>
            <button
              type="button"
              className={`diff-tool-btn${layout === 'side-by-side' ? ' is-on' : ''}`}
              title={
                layout === 'side-by-side' ? t('chat.diff.unified') : t('chat.diff.sideBySide')
              }
              aria-pressed={layout === 'side-by-side'}
              onClick={() =>
                setLayout((m) => (m === 'unified' ? 'side-by-side' : 'unified'))
              }
            >
              <Columns2 size={14} />
              <span>
                {layout === 'side-by-side'
                  ? t('chat.diff.sideBySideShort')
                  : t('chat.diff.unifiedShort')}
              </span>
            </button>
            <button
              type="button"
              className={`diff-tool-btn${fullFile ? ' is-on' : ''}`}
              title={fullFile ? t('chat.diff.fullFileOff') : t('chat.diff.fullFile')}
              aria-pressed={fullFile}
              onClick={() => setFullFile((v) => !v)}
            >
              <FileText size={14} />
              <span>{t('chat.diff.fullFileShort')}</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label={t('chat.diff.close')}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="diff-stacked-scroll">
          {visibleFiles.length === 0 && (
            <p className="section-hint" style={{ padding: 16 }}>
              {scope === 'turn' ? t('chat.diff.scope.turnEmpty') : t('git.clean')}
            </p>
          )}
          {visibleFiles.map((file) => (
            <FileDiffBlock
              key={`${scope}:${file.path}`}
              file={file}
              projectId={projectId}
              expanded={expanded.has(file.path)}
              onToggle={() => toggleFile(file.path)}
              stagedScope={stagedScope}
              layout={layout}
              wrap={wrap}
              fullFile={fullFile}
            />
          ))}
        </div>
      </div>
    </Modal>
  )
}
