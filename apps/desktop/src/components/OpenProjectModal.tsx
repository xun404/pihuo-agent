import { useEffect, useRef, useState } from 'react'
import { isAbsoluteFsPath } from '../lib/directory-from-files'
import { pickProjectDirectory } from '../lib/native-dialogs'
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
 * Browse invokes the native OS folder picker via Electron IPC
 * (dialog:openDirectory → pick-directory.ts → dialog.showOpenDialog /
 * osascript / PowerShell / zenity). No HTML <input webkitdirectory>
 * "upload" panel is used. Manual absolute-path entry remains as a fallback.
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
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setPath('')
      setError(null)
      setStatus(null)
      setBusy(false)
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

  const browse = async () => {
    setError(null)
    setStatus('请在弹出的系统窗口中选择文件夹…')
    setBusy(true)
    try {
      const picked = await pickProjectDirectory({
        title,
        buttonLabel: '选择此文件夹',
      })
      if (picked) {
        applyPath(picked)
      } else {
        setStatus(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus(null)
    } finally {
      setBusy(false)
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
              void browse()
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
        点击「{browseLabel}」打开系统文件夹选择器；或在 Finder 中复制路径后粘贴到上方输入框。
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
