import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'

export interface ConfirmDialogConfig {
  /** Dialog heading, e.g. "Delete project". */
  title: string
  /** Body copy; supports multi-line via ReactNode for richer impact summaries. */
  message: ReactNode
  /** Confirm button label, e.g. "Delete". */
  confirmLabel: string
  /** Cancel button label. Defaults handled by caller. */
  cancelLabel: string
  /** Red destructive styling for the confirm button (delete/archive actions). */
  danger?: boolean
  /** Async action run on confirm; the dialog stays open (busy) until it resolves. */
  onConfirm: () => Promise<void>
}

interface Props {
  open: boolean
  config: ConfirmDialogConfig | null
  onClose: () => void
}

/**
 * Generic in-app confirmation modal, replacing native OS confirm dialogs. Drives a pending async
 * action with a busy state so the user gets feedback while it runs. Caller owns the open/config
 * state; closing (cancel/backdrop/ESC) never runs the action.
 *
 * Keeps the last config mounted during the close animation so Modal's AnimatePresence can play
 * the exit transition instead of the dialog vanishing instantly when the caller nulls the state.
 */
export function ConfirmDialog({ open, config, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  // Remember the most recent config so the exit animation has content to render after the caller
  // sets open=false / config=null.
  const lastConfig = useRef<ConfirmDialogConfig | null>(config)
  if (config) lastConfig.current = config
  const rendered = config ?? lastConfig.current

  // Reset busy whenever a new confirmation is opened.
  useEffect(() => {
    if (open) setBusy(false)
  }, [open])

  if (!rendered) return null

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await rendered.onConfirm()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={rendered.title}
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      <div className="confirm-dialog">
        <h3 className="confirm-dialog-title">{rendered.title}</h3>
        <div className="confirm-dialog-message">{rendered.message}</div>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            {rendered.cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${rendered.danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            {rendered.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
