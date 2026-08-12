import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { SessionPermissionMode } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import {
  THINKING_INTENSITY_OPTIONS,
  saveThinkingIntensity,
  type ThinkingIntensity,
} from '../lib/settings'
import {
  rememberModelThinkingIntensity,
  resolveModelThinkingIntensity,
} from '../lib/model-thinking-memory'
import { ProviderLogo } from '../lib/provider-icons'
import { formatTokenCountDisplay } from '../lib/context-window'
import { ContextRing, IconCheck, Zap, ZapOff } from './Icons'
import type { Locale } from '../i18n/locales'
import { PermissionModeAction } from './PermissionModeAction'

/**
 * Shared composer toolbar: permission action + ContextRing + model cascade +
 * thinking intensity. Used by both the in-session ChatPanel composer and the
 * empty-state home composer so the controls are identical.
 *
 * All selection state (permissionMode / selectedModel / thinking) is
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

export interface TeamTemplateOption {
  id: string
  name: string
  disabled: boolean
  reason?: string
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

const THINKING_INTENSITY_RANK: Record<ThinkingIntensity, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
}

type ThinkingParticle = Readonly<{
  top: string
  size: number
  duration: string
  delay: string
  drift: string
  opacity: number
}>

// A deliberately uneven constellation: distinct lanes, sizes, phases, and
// durations prevent the MAX treatment from reading as a marching dotted line.
// Negative delays make the field feel populated the instant MAX is selected.
const MAX_THINKING_PARTICLES: readonly ThinkingParticle[] = [
  { top: '18%', size: 2.4, duration: '1.06s', delay: '-0.12s', drift: '-2px', opacity: 0.92 },
  { top: '68%', size: 1.6, duration: '1.74s', delay: '-0.68s', drift: '2px', opacity: 0.64 },
  { top: '36%', size: 2.8, duration: '1.31s', delay: '-0.41s', drift: '1px', opacity: 0.98 },
  { top: '82%', size: 1.3, duration: '2.08s', delay: '-1.36s', drift: '-2px', opacity: 0.56 },
  { top: '52%', size: 2.1, duration: '1.48s', delay: '-0.93s', drift: '3px', opacity: 0.82 },
  { top: '12%', size: 1.4, duration: '1.91s', delay: '-0.25s', drift: '2px', opacity: 0.68 },
  { top: '74%', size: 2.5, duration: '1.19s', delay: '-0.79s', drift: '-1px', opacity: 0.88 },
  { top: '44%', size: 1.7, duration: '2.26s', delay: '-1.82s', drift: '-3px', opacity: 0.62 },
  { top: '26%', size: 2.2, duration: '1.57s', delay: '-1.14s', drift: '2px', opacity: 0.78 },
  { top: '88%', size: 1.2, duration: '1.38s', delay: '-0.52s', drift: '-2px', opacity: 0.52 },
] as const

/** `max` is the current top of the thinking ladder; later higher levels opt in by rank. */
export function hasMaxThinkingAnimation(intensity: ThinkingIntensity): boolean {
  return THINKING_INTENSITY_RANK[intensity] >= THINKING_INTENSITY_RANK.max
}

/** Map the model's sparse, supported thinking levels onto contiguous slider steps. */
export function thinkingSliderIndex(
  levels: ThinkingIntensity[],
  intensity: ThinkingIntensity,
): number {
  const index = levels.indexOf(intensity)
  return index >= 0 ? index : 0
}

/** Resolve a native range input value back into a supported thinking level. */
export function thinkingIntensityForSliderIndex(
  levels: ThinkingIntensity[],
  index: number,
): ThinkingIntensity | null {
  if (levels.length === 0) return null
  const clamped = Math.min(levels.length - 1, Math.max(0, Math.round(index)))
  return levels[clamped] ?? null
}

function ThinkingIntensitySlider({
  levels,
  intensity,
  intensityLabel,
  ariaLabel,
  onChange,
}: {
  levels: ThinkingIntensity[]
  intensity: ThinkingIntensity
  intensityLabel: string
  ariaLabel: string
  onChange: (level: ThinkingIntensity) => void
}) {
  const max = Math.max(0, levels.length - 1)
  const index = thinkingSliderIndex(levels, intensity)
  const progress = max > 0 ? (index / max) * 100 : 0
  // The visual positioner is inset by one thumb radius. It keeps a selected
  // dot and its thumb on the same center while keeping both inside the rail.
  // Keep the fill itself at a fixed, pill-shaped size and animate only its
  // clipping edge. Resizing a zero-width rounded element can briefly paint a
  // square edge in Chromium before the radius is rasterized.
  const remainingProgress = 100 - progress
  const fillClipPath =
    index === 0
      ? 'inset(0 100% 0 0)'
      : index === max
        ? 'inset(0)'
        : `inset(0 calc(${remainingProgress}% - ${(14 * remainingProgress) / 100}px) 0 0)`
  const isOff = intensity === 'off'
  const isBoosted = hasMaxThinkingAnimation(intensity)

  return (
    <div className={`thinking-slider-content${isBoosted ? ' is-boosted' : ''}`}>
      <span className="thinking-slider-name">{ariaLabel}</span>
      <div className="thinking-slider-control">
        <div className="thinking-slider-track" aria-hidden>
          <span className="thinking-slider-positioner">
            <span className="thinking-slider-fill" style={{ clipPath: fillClipPath }}>
              {isBoosted && (
                <span className="thinking-slider-particles" aria-hidden>
                  {MAX_THINKING_PARTICLES.map((particle) => (
                    <span
                      className="thinking-slider-particle"
                      key={particle.delay}
                      style={
                        {
                          '--thinking-slider-particle-top': particle.top,
                          '--thinking-slider-particle-size': `${particle.size}px`,
                          '--thinking-slider-particle-duration': particle.duration,
                          '--thinking-slider-particle-delay': particle.delay,
                          '--thinking-slider-particle-drift': particle.drift,
                          '--thinking-slider-particle-opacity': String(particle.opacity),
                          '--thinking-slider-particle-fade-opacity': String(
                            particle.opacity * 0.74,
                          ),
                        } as React.CSSProperties
                      }
                    />
                  ))}
                </span>
              )}
            </span>
            <span className="thinking-slider-marks">
              {levels.map((level, levelIndex) => {
                const position = max > 0 ? (levelIndex / max) * 100 : 0
                return (
                  <span
                    className={`thinking-slider-mark${levelIndex <= index ? ' is-active' : ''}${
                      levelIndex === index ? ' is-current' : ''
                    }`}
                    key={level}
                    style={{ left: `${position}%` }}
                  />
                )
              })}
            </span>
            {!isBoosted && (
              <span
                key={intensity}
                className="thinking-slider-step-pulse"
                style={{ left: `${progress}%` }}
              />
            )}
            <span className="thinking-slider-thumb" style={{ left: `${progress}%` }} />
          </span>
        </div>
        <input
          className="thinking-slider-input"
          type="range"
          min={0}
          max={max}
          step={1}
          value={index}
          aria-label={ariaLabel}
          aria-valuetext={intensityLabel}
          onChange={(event) => {
            const next = thinkingIntensityForSliderIndex(levels, Number(event.currentTarget.value))
            if (next) onChange(next)
          }}
        />
      </div>
      {isOff ? (
        <ZapOff
          className="thinking-slider-status-icon is-off"
          size={17}
          strokeWidth={1.75}
          aria-hidden
        />
      ) : (
        <Zap
          className={`thinking-slider-status-icon${isBoosted ? ' is-boosted' : ''}`}
          size={17}
          strokeWidth={1.75}
          aria-hidden
        />
      )}
    </div>
  )
}

export interface ComposerToolbarProps {
  /** Current Session permission mode (controlled). */
  permissionMode: SessionPermissionMode
  /** Permission shield scope; Home uses a one-session draft override. */
  permissionScope?: 'session' | 'draft'
  permissionSaving?: boolean
  permissionPendingCount?: number
  permissionFailureCount?: number
  /** Currently selected model id (controlled). */
  selectedModel: string
  /** Currently selected thinking intensity (controlled). */
  thinkingIntensity: ThinkingIntensity
  /** Model list (loaded by parent). */
  models: ModelOption[]
  modelsLoading?: boolean
  /** Token usage for the ContextRing. Empty state passes 0. */
  tokenCount?: number
  /**
   * Real token usage from the model (snapshot-driven). `lastInputTokens` drives
   * the context ring (most-recent-turn prompt size); `inputTokens`/`cachedTokens`
   * are cumulative and drive the cache-hit-rate row. Omit for empty state.
   */
  tokenUsage?: {
    inputTokens: number
    cachedTokens: number
    outputTokens: number
    lastInputTokens: number
  }
  /** Active session id (for the compress-context call). Omit when no session. */
  sessionId?: string
  /** Fired when the user clicks "Compress context". The parent owns the actual
   * API call + the compaction-marker timeline + message-list refresh.
   * May resolve to a boolean (true = compression actually happened). */
  onCompressContext?: () => void | Promise<void | boolean>
  /** Locale for number formatting. */
  locale: Locale
  /** Persist the global fallback setting (per-model memory is always recorded). */
  persistThinking?: boolean
  onPermissionModeChange: (mode: SessionPermissionMode) => void | Promise<void>
  /** Model selection only; the toolbar restores its paired thinking tier. */
  onModelChange: (modelId: string) => void
  onThinkingChange: (intensity: ThinkingIntensity) => void
  /** Open settings (for "manage models" / no-model-configured). */
  onOpenSettings?: (tab?: 'model') => void
  /** Home-only saved Team selector. Omit or pass an empty list to hide it. */
  teamTemplateOptions?: TeamTemplateOption[]
  selectedTeamTemplateId?: string
  onTeamTemplateChange?: (templateId: string) => void
}

export function ComposerToolbar({
  permissionMode,
  permissionScope = 'session',
  permissionSaving = false,
  permissionPendingCount = 0,
  permissionFailureCount = 0,
  selectedModel,
  thinkingIntensity,
  models,
  modelsLoading = false,
  tokenCount = 0,
  tokenUsage,
  sessionId,
  onCompressContext,
  locale,
  persistThinking = true,
  onPermissionModeChange,
  onModelChange,
  onThinkingChange,
  onOpenSettings,
  teamTemplateOptions = [],
  selectedTeamTemplateId = '',
  onTeamTemplateChange,
}: ComposerToolbarProps) {
  const { t } = useI18n()

  // —— local menu open/close state ——
  const [teamMenuOpen, setTeamMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelSideOpen, setModelSideOpen] = useState(false)
  const [ctxTipOpen, setCtxTipOpen] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const teamWrapRef = useRef<HTMLDivElement>(null)
  const modelWrapRef = useRef<HTMLDivElement>(null)
  const modelSideRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const [sideMaxHeight, setSideMaxHeight] = useState(360)

  // Cascade side menus open upward from the main menu's bottom; clamp their
  // height to the space actually available above it so long model lists stay
  // fully reachable regardless of window size / composer height.
  useEffect(() => {
    if (!modelSideOpen) return
    const el = modelMenuRef.current
    if (!el) return
    const bottom = el.getBoundingClientRect().bottom
    setSideMaxHeight(Math.max(120, Math.min(360, Math.round(bottom - 16))))
  }, [modelSideOpen])

  const selectThinking = (level: ThinkingIntensity) => {
    // This is the only explicit thinking action, so it is the only path that
    // writes per-model memory. Automatic fallbacks remain non-sticky.
    rememberModelThinkingIntensity(selectedModel, level)
    onThinkingChange(level)
    // Keep the model/thinking cascade open so the user can tweak both without
    // reopening the menu after every click.
    if (persistThinking) {
      void saveThinkingIntensity(level).catch((e) => {
        console.warn('[ComposerToolbar] save thinkingIntensity failed', e)
      })
    }
  }

  const selectModel = (model: ModelOption) => {
    onModelChange(model.id)
    // A model change applies its saved level when compatible, otherwise the
    // shared tier calculator. Do not route this through selectThinking: a
    // fallback should not overwrite the model's last explicit preference.
    const nextThink = resolveModelThinkingIntensity(model.id, model.thinkingIntensities)
    if (nextThink !== thinkingIntensity) onThinkingChange(nextThink)
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
  const modelChipTitle = [modelShort, thinkShort].filter(Boolean).join(' · ')

  // —— derived: context meter ——
  // The ring shows the prompt size the model saw on the MOST RECENT turn
  // (`usageLastInputTokens` — real, model-reported). That is the best proxy
  // for "current context occupancy": it includes system prompt + tool schemas
  // + reasoning that a chars/4 estimate misses, AND it drops after a context
  // compression (the next turn's prompt is shorter). Falls back to the live
  // chars/4 estimate (`tokenCount`) before the first turn / on legacy data.
  //
  // `tokenUsage.inputTokens` (cumulative) is NOT used here — it only grows and
  // would never reflect a compression. It feeds the cache-hit-rate row only.
  const ctxTotal =
    selectedMeta?.contextWindow && selectedMeta.contextWindow > 0
      ? selectedMeta.contextWindow
      : 1_000_000
  const lastInputTokens = tokenUsage?.lastInputTokens ?? 0
  const approxTokens = Math.min(
    ctxTotal,
    lastInputTokens > 0 ? lastInputTokens : Math.round(tokenCount),
  )
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
  // Cache hit rate = cachedInputTokens / inputTokens across the whole session
  // (cumulative real values from the model). Display null (—) until there is
  // real data: a hardcoded 99.89% placeholder was misleading before any turn.
  const realInputTokens = tokenUsage?.inputTokens ?? 0
  const cachedTokens = tokenUsage?.cachedTokens ?? 0
  const cacheHitPct =
    realInputTokens > 0 ? Math.min(100, (cachedTokens / realInputTokens) * 100) : null
  const cacheHitLabel =
    cacheHitPct == null
      ? null
      : cacheHitPct % 1 === 0
        ? `${Math.round(cacheHitPct)}%`
        : `${cacheHitPct.toFixed(1)}%`

  const handleCompressContext = async () => {
    if (!sessionId || compressing) return
    // Delegate to the parent (ChatPanel), which owns the compaction-marker
    // timeline + message-list refresh. The button just reports its loading
    // state locally and fires the callback.
    setCompressing(true)
    try {
      await onCompressContext?.()
    } finally {
      setCompressing(false)
    }
  }

  const supportedThinking: ThinkingIntensity[] = selectedMeta?.thinkingIntensities?.length
    ? selectedMeta.thinkingIntensities
    : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])

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

  const selectedTeamLabel =
    teamTemplateOptions.find((option) => option.id === selectedTeamTemplateId)?.name ??
    t('chat.defaultTeam')

  // —— Close popovers on outside click ——
  // Mirrors the original ChatPanel logic, but uses ComposerToolbar's own
  // state/refs (ChatPanel's copy became dead code after extraction).
  useEffect(() => {
    if (!teamMenuOpen && !modelMenuOpen && !ctxTipOpen) return
    const onDoc = (e: MouseEvent) => {
      if (teamMenuOpen && teamWrapRef.current && !teamWrapRef.current.contains(e.target as Node)) {
        setTeamMenuOpen(false)
      }
      // model menu + its sub-panels + ctx tip all live inside model-wrap:
      // close them all when clicking outside model-wrap
      if (
        (modelMenuOpen || ctxTipOpen || modelSideOpen) &&
        modelWrapRef.current &&
        !modelWrapRef.current.contains(e.target as Node)
      ) {
        setModelMenuOpen(false)
        setModelSideOpen(false)
        setCtxTipOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [teamMenuOpen, modelMenuOpen, modelSideOpen, ctxTipOpen])

  // —— Close all popovers when the window loses focus (Alt-Tab / app switch) ——
  useEffect(() => {
    if (!teamMenuOpen && !modelMenuOpen && !ctxTipOpen && !modelSideOpen) return
    const onBlur = () => {
      setTeamMenuOpen(false)
      setModelMenuOpen(false)
      setModelSideOpen(false)
      setCtxTipOpen(false)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [teamMenuOpen, modelMenuOpen, modelSideOpen, ctxTipOpen])

  return (
    <>
      <PermissionModeAction
        mode={permissionMode}
        saving={permissionSaving}
        pendingApprovalCount={permissionPendingCount}
        failureCount={permissionFailureCount}
        scope={permissionScope}
        onChange={onPermissionModeChange}
      />

      {teamTemplateOptions.length > 0 && (
        <div className="mode-menu-wrap home-team-menu-wrap" ref={teamWrapRef}>
          <button
            type="button"
            className="chip menu"
            aria-label={t('chat.team')}
            aria-expanded={teamMenuOpen}
            title={selectedTeamLabel}
            onClick={() => {
              setTeamMenuOpen((v) => !v)
              setModelMenuOpen(false)
            }}
          >
            {selectedTeamLabel}
            <span className="caret">▾</span>
          </button>
          <AnimatePresence>
            {teamMenuOpen && (
              <motion.div
                className="pop-menu mode-menu home-team-menu"
                role="menu"
                aria-label={t('chat.team')}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
              >
                <button
                  type="button"
                  className={`pop-row${selectedTeamTemplateId === '' ? ' on' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    onTeamTemplateChange?.('')
                    setTeamMenuOpen(false)
                  }}
                >
                  {t('chat.defaultTeam')}
                  {selectedTeamTemplateId === '' && (
                    <span className="check">
                      <IconCheck size={14} />
                    </span>
                  )}
                </button>
                {teamTemplateOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`pop-row${selectedTeamTemplateId === option.id ? ' on' : ''}${
                      option.disabled ? ' is-disabled' : ''
                    }`}
                    role="menuitem"
                    disabled={option.disabled}
                    title={option.reason}
                    onClick={() => {
                      if (option.disabled) return
                      onTeamTemplateChange?.(option.id)
                      setTeamMenuOpen(false)
                    }}
                  >
                    <span className="home-team-option">
                      <span className="home-team-option-name">{option.name}</span>
                      {option.disabled && option.reason ? (
                        <span className="home-team-option-reason">{option.reason}</span>
                      ) : null}
                    </span>
                    {selectedTeamTemplateId === option.id && !option.disabled && (
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
      )}

      <div className="spacer" />

      <div className="model-wrap" ref={modelWrapRef}>
        <span
          className="ctx-meter-hit"
          title={t('chat.ctxTitle')}
          onClick={() => {
            setCtxTipOpen((v) => !v)
            setModelMenuOpen(false)
            setModelSideOpen(false)
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
                  <span className="t-value">{cacheHitLabel ?? t('chat.ctxNoData')}</span>
                </div>
                <button
                  type="button"
                  className="ctx-tip-btn"
                  disabled={!sessionId || compressing}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleCompressContext()
                  }}
                >
                  {compressing ? t('chat.ctxCompressing') : t('chat.ctxCompress')}
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
            className="chip menu model-chip"
            title={selectedModel ? `${selectedModel} · ${thinkShort}` : modelChipTitle}
            disabled={modelsLoading}
            onClick={() => {
              setModelMenuOpen((v) => !v)
              setCtxTipOpen(false)
            }}
          >
            {modelsLoading ? (
              <span className="chip-label">{t('app.loading')}</span>
            ) : (
              <span className="chip-label">
                <span className="chip-model">{modelShort}</span>
                {thinkShort ? (
                  <span className="chip-sep" aria-hidden>
                    {' '}
                    ·{' '}
                  </span>
                ) : null}
                {thinkShort ? <span className="chip-think">{thinkShort}</span> : null}
              </span>
            )}
            <span className="caret">▾</span>
          </button>
        )}

        <AnimatePresence>
          {modelMenuOpen && models.length > 0 && (
            <motion.div
              ref={modelMenuRef}
              className={`pop-menu model-menu${
                supportedThinking.length > 0 ? ' has-thinking-slider' : ''
              }`}
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
                }}
              >
                {t('chat.model')}
                <span className="val">
                  {modelShort}
                  <span className="arrow">‹</span>
                </span>
              </button>
              {supportedThinking.length > 0 && (
                <section className="thinking-slider-inline" aria-label={t('chat.think.label')}>
                  <ThinkingIntensitySlider
                    levels={supportedThinking}
                    intensity={thinkingIntensity}
                    intensityLabel={thinkShort}
                    ariaLabel={t('chat.think.label')}
                    onChange={selectThinking}
                  />
                </section>
              )}
              <div className="pop-manage">
                <button
                  type="button"
                  className="pop-row pop-manage-btn"
                  onClick={() => {
                    setModelMenuOpen(false)
                    setModelSideOpen(false)
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
                {modelSideOpen && (
                  <motion.div
                    className="pop-side pop-side-cascade pop-side-models"
                    ref={modelSideRef}
                    style={{ maxHeight: sideMaxHeight }}
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
                              selectModel(m)
                              // Leave the cascade open: model + thinking are often
                              // adjusted together; only outside-click / Esc closes.
                            }}
                          >
                            <span className="pop-label">{m.label}</span>
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
