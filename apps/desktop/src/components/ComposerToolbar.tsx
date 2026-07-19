import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LeaderMode, SessionApprovalPolicy } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import {
  THINKING_INTENSITY_OPTIONS,
  saveThinkingIntensity,
  type ThinkingIntensity,
} from '../lib/settings'
import { ProviderLogo } from '../lib/provider-icons'
import {
  ACCESS_MODES,
  accessModeById,
  resolveAccessMode,
  type AccessModeId,
} from '../lib/access-mode'
import { formatTokenCountDisplay } from '../lib/context-window'
import { AccessModeIcon, ContextRing, IconCheck } from './Icons'
import type { Locale } from '../i18n/locales'

/**
 * Shared composer toolbar: access mode menu + ContextRing + model cascade +
 * thinking intensity. Used by both the in-session ChatPanel composer and the
 * empty-state home composer so the controls are identical.
 *
 * All selection state (mode / approvalPolicy / selectedModel / thinking) is
 * controlled by the parent via props + onChange callbacks. Menu open/close
 * state is local. Token-usage (ContextRing) data is computed from the parent-
 * supplied model + optional message token count; in empty state pass
 * tokenCount = 0.
 */

export type ModelOption = {
  id: string
  label: string
  providerId: string
  providerName: string
  configured: boolean
  thinkingIntensities: ThinkingIntensity[]
  contextWindow?: number
}

const THINK_LABEL_KEY: Record<
  ThinkingIntensity,
  | 'chat.think.off'
  | 'chat.think.low'
  | 'chat.think.medium'
  | 'chat.think.high'
  | 'chat.think.xhigh'
  | 'chat.think.max'
> = {
  off: 'chat.think.off',
  low: 'chat.think.low',
  medium: 'chat.think.medium',
  high: 'chat.think.high',
  xhigh: 'chat.think.xhigh',
  max: 'chat.think.max',
}

/**
 * Pick the thinking intensity for a model: the HIGHEST supported level
 * (THINKING_INTENSITY_OPTIONS is ordered low→high). Empty supported → 'off'.
 * Pure; matches ChatPanel's original clampThink exactly.
 */
export function clampThink(
  _preferred: ThinkingIntensity | undefined,
  supported: ThinkingIntensity[],
): ThinkingIntensity {
  const list =
    supported.length > 0 ? supported : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])
  let best: ThinkingIntensity = 'off'
  let bestRank = -1
  for (const lv of list) {
    const rank = THINKING_INTENSITY_OPTIONS.indexOf(lv)
    if (rank > bestRank) {
      bestRank = rank
      best = lv
    }
  }
  return best
}

export interface ComposerToolbarProps {
  /** Current LeaderMode (controlled). */
  mode: LeaderMode
  /** Current approval policy (controlled) — drives access mode derivation. */
  approvalPolicy: SessionApprovalPolicy
  /** Currently selected model id (controlled). */
  selectedModel: string
  /** Currently selected thinking intensity (controlled). */
  thinkingIntensity: ThinkingIntensity
  /** Model list (loaded by parent). */
  models: ModelOption[]
  modelsLoading?: boolean
  /** Token usage for the ContextRing. Empty state passes 0. */
  tokenCount?: number
  /** Locale for number formatting. */
  locale: Locale
  /** Persist thinking selection to settings (no-op in empty state). */
  persistThinking?: boolean
  /** Fired when access mode selection changes — parent updates mode + policy. */
  onModeChange: (mode: LeaderMode) => void
  onApprovalPolicyChange: (policy: SessionApprovalPolicy) => void
  /** Fired when model / thinking selection changes. */
  onModelChange: (modelId: string) => void
  onThinkingChange: (intensity: ThinkingIntensity) => void
  /** Open settings (for "manage models" / no-model-configured). */
  onOpenSettings?: (tab?: 'model') => void
}

export function ComposerToolbar({
  mode,
  approvalPolicy,
  selectedModel,
  thinkingIntensity,
  models,
  modelsLoading = false,
  tokenCount = 0,
  locale,
  persistThinking = true,
  onModeChange,
  onApprovalPolicyChange,
  onModelChange,
  onThinkingChange,
  onOpenSettings,
}: ComposerToolbarProps) {
  const { t } = useI18n()

  // —— local menu open/close state ——
  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelSideOpen, setModelSideOpen] = useState(false)
  const [thinkMenuOpen, setThinkMenuOpen] = useState(false)
  const [ctxTipOpen, setCtxTipOpen] = useState(false)
  const accessWrapRef = useRef<HTMLDivElement>(null)
  const modelWrapRef = useRef<HTMLDivElement>(null)
  const thinkWrapRef = useRef<HTMLDivElement>(null)

  // —— derived: access mode ——
  const accessModeId: AccessModeId = resolveAccessMode(mode, approvalPolicy)
  const accessMode = accessModeById(accessModeId)

  const selectAccessMode = (id: AccessModeId) => {
    const def = accessModeById(id)
    onModeChange(def.mode)
    onApprovalPolicyChange(def.policy)
    setAccessMenuOpen(false)
  }

  const selectThinking = (level: ThinkingIntensity) => {
    onThinkingChange(level)
    setThinkMenuOpen(false)
    if (persistThinking) {
      void saveThinkingIntensity(level).catch((e) => {
        console.warn('[ComposerToolbar] save thinkingIntensity failed', e)
      })
    }
  }

  // —— derived: model / thinking chip labels ——
  const selectedMeta = models.find((m) => m.id === selectedModel)
  const modelShort = selectedMeta
    ? selectedMeta.label
    : selectedModel
      ? selectedModel.includes('/')
        ? selectedModel.slice(selectedModel.indexOf('/') + 1)
        : selectedModel
      : t('chat.model')
  const thinkShort = t(THINK_LABEL_KEY[thinkingIntensity] ?? 'chat.think.medium')
  const modelChipLabel = `${modelShort} ${thinkShort}`

  // —— derived: context meter ——
  const ctxTotal =
    selectedMeta?.contextWindow && selectedMeta.contextWindow > 0
      ? selectedMeta.contextWindow
      : 1_000_000
  const approxTokens = Math.min(ctxTotal, Math.round(tokenCount))
  const ctxPctRaw = ctxTotal > 0 ? (approxTokens / ctxTotal) * 100 : 0
  const ctxPct = Math.min(100, Math.round(ctxPctRaw * 10) / 10)
  const ctxUsedLabel = formatTokenCountDisplay(approxTokens, locale)
  const ctxTotalLabel = formatTokenCountDisplay(ctxTotal, locale)
  const ctxPctLabel =
    ctxPctRaw > 0 && ctxPctRaw < 0.1
      ? ctxPctRaw.toFixed(2)
      : ctxPct % 1 === 0
        ? String(Math.round(ctxPct))
        : ctxPct.toFixed(1)

  const supportedThinking: ThinkingIntensity[] = selectedMeta?.thinkingIntensities?.length
    ? selectedMeta.thinkingIntensities
    : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])

  // When model changes, clamp thinking to what that model supports.
  useEffect(() => {
    if (!selectedMeta) return
    const next = clampThink(thinkingIntensity, selectedMeta.thinkingIntensities)
    if (next !== thinkingIntensity) {
      onThinkingChange(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel])

  const byProvider = useMemo(() => {
    const map = new Map<string, { name: string; models: ModelOption[] }>()
    for (const m of models) {
      let g = map.get(m.providerId)
      if (!g) {
        g = { name: m.providerName, models: [] }
        map.set(m.providerId, g)
      }
      g.models.push(m)
    }
    return [...map.entries()]
  }, [models])

  // —— Close popovers on outside click ——
  // Mirrors the original ChatPanel logic, but uses ComposerToolbar's own
  // state/refs (ChatPanel's copy became dead code after extraction).
  useEffect(() => {
    if (!accessMenuOpen && !modelMenuOpen && !thinkMenuOpen && !ctxTipOpen) return
    const onDoc = (e: MouseEvent) => {
      // access menu: close when clicking outside its wrapper
      if (accessMenuOpen && accessWrapRef.current && !accessWrapRef.current.contains(e.target as Node)) {
        setAccessMenuOpen(false)
      }
      // model menu + its sub-panels + ctx tip all live inside model-wrap:
      // close them all when clicking outside model-wrap
      if (
        (modelMenuOpen || thinkMenuOpen || ctxTipOpen || modelSideOpen) &&
        modelWrapRef.current &&
        !modelWrapRef.current.contains(e.target as Node)
      ) {
        setModelMenuOpen(false)
        setModelSideOpen(false)
        setThinkMenuOpen(false)
        setCtxTipOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [accessMenuOpen, modelMenuOpen, modelSideOpen, thinkMenuOpen, ctxTipOpen])

  // —— Close all popovers when the window loses focus (Alt-Tab / app switch) ——
  useEffect(() => {
    if (!accessMenuOpen && !modelMenuOpen && !thinkMenuOpen && !ctxTipOpen && !modelSideOpen) return
    const onBlur = () => {
      setAccessMenuOpen(false)
      setModelMenuOpen(false)
      setModelSideOpen(false)
      setThinkMenuOpen(false)
      setCtxTipOpen(false)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [accessMenuOpen, modelMenuOpen, modelSideOpen, thinkMenuOpen, ctxTipOpen])

  return (
    <>
      <div className="mode-menu-wrap" ref={accessWrapRef}>
        <button
          type="button"
          className={`chip menu${accessMode.accent ? ' access' : ''}`}
          onClick={() => {
            setAccessMenuOpen((v) => !v)
            setModelMenuOpen(false)
            setThinkMenuOpen(false)
          }}
        >
          <AccessModeIcon id={accessMode.id} size={13} className="chip-ico" />
          {t(accessMode.titleKey)}
          <span className="caret">▾</span>
        </button>
        <AnimatePresence>
          {accessMenuOpen && (
            <motion.div
              className="pop-menu mode-menu"
              role="menu"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
            >
              {ACCESS_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`pop-item${accessModeId === m.id ? ' on' : ''}${
                    m.accent ? ' access' : ''
                  }`}
                  role="menuitem"
                  onClick={() => selectAccessMode(m.id)}
                >
                  <span className={`pi${m.accent ? ' accent' : ''}`} aria-hidden>
                    <AccessModeIcon id={m.id} size={16} />
                  </span>
                  <span className="pi-body">
                    <div className="pi-title">{t(m.titleKey)}</div>
                    <div className="pi-desc">{t(m.descKey)}</div>
                  </span>
                  {accessModeId === m.id && (
                    <span className="check">
                      <IconCheck size={14} />
                    </span>
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="spacer" />

      <div className="model-wrap" ref={modelWrapRef}>
        <span
          className="ctx-meter-hit"
          title={t('chat.ctxTitle')}
          onClick={() => {
            setCtxTipOpen((v) => !v)
            setModelMenuOpen(false)
            setModelSideOpen(false)
            setThinkMenuOpen(false)
          }}
        >
          <ContextRing
            pct={ctxPct}
            title={t('chat.ctxStats', {
              used: ctxUsedLabel,
              total: ctxTotalLabel,
              pct: ctxPctLabel,
            })}
          />
          <AnimatePresence>
            {ctxTipOpen && (
              <motion.div
                className="ctx-tip"
                role="dialog"
                aria-label={t('chat.ctxTitle')}
                initial={{ opacity: 0, x: '-50%', y: 4 }}
                animate={{ opacity: 1, x: '-50%', y: 0 }}
                exit={{ opacity: 0, x: '-50%', y: 4 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
              >
                <div className="ctx-tip-head">
                  <span className="t-title">{t('chat.ctxTitle')}</span>
                  <span className="t-stats">
                    {t('chat.ctxStats', {
                      used: ctxUsedLabel,
                      total: ctxTotalLabel,
                      pct: ctxPctLabel,
                    })}
                  </span>
                </div>
                <div
                  className="ctx-tip-bar"
                  role="progressbar"
                  aria-valuenow={Math.round(ctxPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="ctx-tip-bar-fill"
                    style={{ width: `${Math.min(100, Math.max(0, ctxPct))}%` }}
                  />
                </div>
                <div className="ctx-tip-cache">
                  <span className="t-label">{t('chat.ctxCacheHit')}</span>
                  <span className="t-value">99.89%</span>
                </div>
                <button
                  type="button"
                  className="ctx-tip-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
                >
                  {t('chat.ctxCompress')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </span>

        {!modelsLoading && models.length === 0 ? (
          <button type="button" className="chip menu" onClick={() => onOpenSettings?.('model')}>
            {t('chat.noModelConfigured')} →
          </button>
        ) : (
          <button
            type="button"
            className="chip menu"
            title={selectedModel}
            disabled={modelsLoading}
            onClick={() => {
              setModelMenuOpen((v) => !v)
              setCtxTipOpen(false)
              setAccessMenuOpen(false)
            }}
          >
            {modelsLoading ? t('app.loading') : modelChipLabel}
            <span className="caret">▾</span>
          </button>
        )}

        <AnimatePresence>
          {modelMenuOpen && models.length > 0 && (
            <motion.div
              className="pop-menu model-menu"
              role="menu"
              aria-label={t('chat.model')}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
            >
              <button
                type="button"
                className="pop-row"
                role="menuitem"
                onClick={() => {
                  setModelSideOpen((v) => !v)
                  setThinkMenuOpen(false)
                }}
              >
                {t('chat.model')}
                <span className="val">
                  {modelShort}
                  <span className="arrow">‹</span>
                </span>
              </button>
              {supportedThinking.length > 0 && (
                <button
                  type="button"
                  className="pop-row"
                  role="menuitem"
                  onClick={() => {
                    setThinkMenuOpen((v) => !v)
                    setModelSideOpen(false)
                  }}
                >
                  {t('chat.think.label')}
                  <span className="val">
                    {thinkShort}
                    <span className="arrow">‹</span>
                  </span>
                </button>
              )}
              <div className="pop-manage">
                <button
                  type="button"
                  className="pop-row pop-manage-btn"
                  onClick={() => {
                    setModelMenuOpen(false)
                    setModelSideOpen(false)
                    setThinkMenuOpen(false)
                    window.dispatchEvent(
                      new CustomEvent('swarmdesk-agent:open-settings', {
                        detail: { tab: 'model' },
                      }),
                    )
                  }}
                >
                  {t('chat.manageModels')}
                </button>
              </div>
              <AnimatePresence>
                {thinkMenuOpen && supportedThinking.length > 0 && (
                  <motion.div
                    className="pop-side pop-side-cascade"
                    ref={thinkWrapRef}
                    role="menu"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                  >
                    {supportedThinking.map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`pop-row${thinkingIntensity === level ? ' on' : ''}`}
                        role="menuitem"
                        onClick={() => selectThinking(level)}
                      >
                        {t(THINK_LABEL_KEY[level])}
                        {thinkingIntensity === level && (
                          <span className="check">
                            <IconCheck size={14} />
                          </span>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {modelSideOpen && (
                  <motion.div
                    className="pop-side pop-side-cascade pop-side-models"
                    ref={thinkWrapRef}
                    role="menu"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                  >
                    {byProvider.map(([providerId, group]) => (
                      <div key={providerId} className="pop-prov-block">
                        <div className="pop-prov-header">
                          <span className="prov-ico" aria-hidden>
                            <ProviderLogo providerId={providerId} size={14} />
                          </span>
                          <span>{group.name}</span>
                        </div>
                        {group.models.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`pop-row pop-model-row${selectedModel === m.id ? ' on' : ''}`}
                            role="menuitemradio"
                            aria-checked={selectedModel === m.id}
                            onClick={() => {
                              onModelChange(m.id)
                              const nextThink = clampThink(thinkingIntensity, m.thinkingIntensities)
                              if (nextThink !== thinkingIntensity) onThinkingChange(nextThink)
                              setModelSideOpen(false)
                              setModelMenuOpen(false)
                              setThinkMenuOpen(false)
                            }}
                          >
                            <span>{m.label}</span>
                            {selectedModel === m.id && (
                              <span className="check">
                                <IconCheck size={14} />
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
