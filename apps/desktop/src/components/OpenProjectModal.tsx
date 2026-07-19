import { useEffect, useRef, useState } from 'react'
import { directoryPathFromFileList, isAbsoluteFsPath } from '../lib/directory-from-files'
import { Modal } from './ui/Modal'

interface Props {
  open: boolean
  title: string
  pathLabel: string
  pathPlaceholder: string
  browseLabel: string
  openLabel: string
  cancelLabel: string
  noSelectionLabel?: string
  onCancel: () => void
  onOpen: (path: string) => void
}

/**
 * Open-project modal.
 *
 * Browse uses Chromium directory input + Electron webUtils.getPathForFile.
 * (Native dialog.showOpenDialog returns empty filePaths on this setup;
 *  osascript choose-folder auto-cancels when spawned from Electron.)
 *
 * Note: the system panel may label the confirm button "上传" — that is Chrome/macOS
 * localization for the file panel, not an actual network upload.
 */
export function OpenProjectModal({
  open,
  title,
  pathLabel,
  pathPlaceholder,
  browseLabel,
  openLabel,
  cancelLabel,
  noSelectionLabel = 'No folder selected',
  onCancel,
  onOpen,
}: Props) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setPath('')
      setError(null)
      setStatus(null)
      setBusy(false)
      if (dirInputRef.current) dirInputRef.current.value = ''
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    wasOpenRef.current = open
  }, [open])

  const applyPath = (picked: string) => {
    const p = picked.trim()
    if (!p || !isAbsoluteFsPath(p)) {
      setError(noSelectionLabel)
      setStatus(null)
      return
    }
    setPath(p)
    setError(null)
    setStatus('路径已填入，请点「确定」打开项目')
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(p.length, p.length)
    })
  }

  const submit = () => {
    const p = path.trim()
    if (!p) {
      setError(pathPlaceholder)
      return
    }
    if (!isAbsoluteFsPath(p)) {
      setError('请填写以 / 开头的绝对路径，例如 /Users/你/projects/app')
      return
    }
    onOpen(p)
  }

  const browse = () => {
    setError(null)
    setStatus('请在弹出的窗口中选择文件夹（确认按钮可能显示为「上传」，选中目录即可）')
    const el = dirInputRef.current
    if (!el) {
      setError('无法打开文件夹选择，请手动粘贴路径')
      return
    }
    el.value = ''
    el.click()
  }

  const onDirInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBusy(true)
    setError(null)
    try {
      const list = e.target.files
      if (!list || list.length === 0) {
        setError('未选择文件夹（可再试一次，或粘贴路径）')
        setStatus(null)
        return
      }

      const resolveAbs = (file: File): string | null => {
        const fn = window.routerAgents?.dialog?.getPathForFile
        if (typeof fn === 'function') {
          try {
            const p = fn(file)
            if (typeof p === 'string' && p.trim()) return p.trim()
          } catch (err) {
            console.error('[OpenProjectModal] getPathForFile', err)
          }
        }
        const legacy = (file as File & { path?: string }).path
        if (typeof legacy === 'string' && legacy.trim()) return legacy.trim()
        return null
      }

      // Debug: log first file resolution
      const sample = list.item(0)
      const sampleAbs = sample ? resolveAbs(sample) : null
      console.log('[OpenProjectModal] directory pick', {
        count: list.length,
        rel: sample?.webkitRelativePath,
        abs: sampleAbs,
        hasApi: typeof window.routerAgents?.dialog?.getPathForFile === 'function',
      })

      let dir = directoryPathFromFileList(list, resolveAbs)

      if (!dir) {
        for (let i = 0; i < Math.min(list.length, 30); i++) {
          const f = list.item(i)
          if (!f) continue
          const abs = resolveAbs(f)
          if (!abs) continue
          dir = directoryPathFromFileList(
            [
              { ...f, path: abs, webkitRelativePath: f.webkitRelativePath } as File & {
                path?: string
              },
            ],
            () => abs,
          )
          if (dir) break
          // last resort: dirname of abs path
          if (isAbsoluteFsPath(abs)) {
            const slash = abs.lastIndexOf('/')
            if (slash > 0) {
              // Prefer root from webkitRelativePath
              const root = (f.webkitRelativePath || '').split('/')[0]
              if (root && abs.includes(`/${root}/`)) {
                dir = abs.slice(0, abs.indexOf(`/${root}/`) + root.length + 1)
              } else if (root && abs.endsWith(`/${root}`) === false) {
                const idx = abs.indexOf(`/${root}/`)
                if (idx >= 0) dir = abs.slice(0, idx + 1 + root.length)
                else {
                  // strip filename only
                  dir = abs.slice(0, slash)
                }
              } else {
                dir = abs.slice(0, slash)
              }
            }
          }
          if (dir && isAbsoluteFsPath(dir)) break
        }
      }

      if (dir && isAbsoluteFsPath(dir)) {
        applyPath(dir)
        return
      }

      setError(
        '已选中文件夹，但无法解析绝对路径。请把路径粘贴到上方输入框（可在 Finder 中右键文件夹 → 按住 Option → 复制路径名）。',
      )
      setStatus(null)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      label={title}
      panelClassName="text-prompt-modal open-project-modal"
      closeOnBackdrop={!busy}
    >
      <h3 className="text-prompt-title">{title}</h3>

      <input
        ref={(el) => {
          dirInputRef.current = el
          if (el) {
            el.setAttribute('webkitdirectory', '')
            el.setAttribute('directory', '')
          }
        }}
        type="file"
        multiple
        style={{ display: 'none' }}
        tabIndex={-1}
        onChange={onDirInputChange}
      />

      <label className="settings-field">
        <span>{pathLabel}</span>
        <div className="open-project-path-row">
          <input
            ref={inputRef}
            className="settings-input mono"
            value={path}
            placeholder={pathPlaceholder}
            disabled={busy}
            onChange={(e) => {
              setPath(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!busy) submit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                if (!busy) onCancel()
              }
            }}
          />
          <button
            type="button"
            className="btn btn-soft btn-sm"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              browse()
            }}
          >
            {busy ? '…' : browseLabel}
          </button>
        </div>
      </label>

      {status && (
        <p className="settings-field-hint" style={{ color: 'var(--accent, #6ea8fe)' }}>
          {status}
        </p>
      )}
      <p className="settings-field-hint">
        说明：系统对话框的确认按钮可能显示为「上传」，这是 macOS/Chrome 的固定文案，
        <strong>不会上传到网络</strong>，只是在本机选择文件夹。 也可在 Finder
        中复制路径后粘贴到上方。
      </p>
      {error && <p className="settings-error">{error}</p>}
      {path.trim() !== '' && (
        <p
          className="settings-field-hint mono"
          style={{ wordBreak: 'break-all', color: 'var(--success, #3dd68c)' }}
        >
          ✓ {path}
        </p>
      )}
      <div className="text-prompt-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!path.trim() || busy}
          onClick={submit}
        >
          {openLabel}
        </button>
      </div>
    </Modal>
  )
}
