import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  WORKER_ROLES,
  normalizeWorkerDefaultRoleType,
  type WorkerRegistration,
  type WorkerRole,
} from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import { roleMessageKey } from '../i18n/locales'

interface Props {
  worker: WorkerRegistration
  /** Called whenever the selected role changes. Should persist + report success. */
  onSave: (roleType: WorkerRole) => Promise<void>
}

/**
 * Default-role picker rendered inline in the worker-detail header. A compact
 * chip button showing the current role; clicking opens a pop-menu of roles.
 * Selecting a role persists immediately — no save button.
 *
 *   [通用 ▾]   ← chip button (shows current role)
 *      ┌────────────┐
 *      │ ✓ 通用      │  ← pop-menu
 *      │   规划      │
 *      │   编码      │
 *      │ …          │
 *      └────────────┘
 */
export function WorkerDefaultRoleTypeEditor({ worker, onSave }: Props) {
  const { t } = useI18n()
  const [roleType, setRoleType] = useState<WorkerRole>(() =>
    normalizeWorkerDefaultRoleType(worker.defaultRoleType),
  )
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRoleType(normalizeWorkerDefaultRoleType(worker.defaultRoleType))
  }, [worker.id, worker.defaultRoleType])

  // close on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = async (next: WorkerRole) => {
    setOpen(false)
    if (next === roleType || busy) return
    setRoleType(next)
    setBusy(true)
    try {
      await onSave(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ctx worker-role-picker" ref={wrapRef}>
      <button
        type="button"
        className="worker-role-chip"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('workers.defaultRole')}
      >
        <span className="worker-role-chip-label">{t('roles.type')}</span>
        <span className="worker-role-chip-value">{t(roleMessageKey(roleType))}</span>
        <span className="worker-role-chip-caret" aria-hidden>
          ▾
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="pop-menu worker-role-menu"
            role="menu"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
          >
            {WORKER_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                className={`pop-item${role === roleType ? ' on' : ''}`}
                role="menuitem"
                disabled={busy}
                onClick={() => void pick(role)}
              >
                <span>{t(roleMessageKey(role))}</span>
                {role === roleType && (
                  <span className="worker-role-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
