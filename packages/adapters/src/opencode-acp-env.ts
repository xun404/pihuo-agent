/**
 * OpenCode ACP spawn hygiene.
 *
 * User configs often break `opencode acp`:
 * - `server.port` fixed (e.g. 8081) while another OpenCode already listens → ServeError
 * - `model` points at a provider listed in `disabled_providers` → "Model is disabled"
 *
 * Isolation strategy (verified by debug tests):
 * - Minimal config under a temp HOME/.config/opencode/
 * - Reuse real XDG data/cache so auth still works for paid providers
 * - Prefer free Zen models (`opencode/big-pickle`) unless worker pins a valid model
 * - Never silently remap an ineligible pin to a different model
 *
 * @see https://opencode.ai/docs/acp/
 * @see https://opencode.ai/docs/troubleshooting/
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerModelOption } from '@swarmdesk-agent/shared'
import {
  evaluateModelEligibility,
  ModelEligibilityError,
  type ProviderEvidence,
} from './model-eligibility.js'
import { resolveOpenCodeEvidencePaths } from './opencode-evidence-paths.js'

export { ModelEligibilityError } from './model-eligibility.js'

export const OPENCODE_SAFE_DEFAULT_MODEL =
  process.env.OPENCODE_MODEL?.trim() || 'opencode/big-pickle'

/** Models known to work without custom provider auth (OpenCode Zen free tier). */
export const OPENCODE_ZEN_FREE_MODELS = [
  'opencode/big-pickle',
  'opencode/deepseek-v4-flash-free',
  'opencode/hy3-free',
  'opencode/mimo-v2.5-free',
  'opencode/north-mini-code-free',
  'opencode/nemotron-3-ultra-free',
] as const

export function isLikelyOpenCodeZenModel(modelId: string): boolean {
  return modelId.startsWith('opencode/')
}

function diagnosticOverrideEnabled(pinned: string): boolean {
  if (process.env.OPENCODE_ALLOW_CUSTOM_MODEL === '1') return true
  if (pinned.startsWith('opencode-go/') && process.env.OPENCODE_ALLOW_GO === '1') return true
  return false
}

export interface PickOpenCodeAcpModelOpts {
  pinned?: string | null
  candidates?: WorkerModelOption[]
  providers?: Record<string, ProviderEvidence>
  zenFreeAllowlist?: string[]
  /** diagnostic only — OPENCODE_ALLOW_* also enables this */
  allowOverride?: boolean
}

/**
 * Pick a model id safe for ACP:
 * - No pin → safe default
 * - Pin eligible for execute → pin
 * - Pin ineligible → throw ModelEligibilityError (no silent remap)
 * - OPENCODE_ALLOW_CUSTOM_MODEL / OPENCODE_ALLOW_GO only diagnostic override
 */
export function pickOpenCodeAcpModel(opts: PickOpenCodeAcpModelOpts = {}): string {
  const p = opts.pinned?.trim() || ''
  if (!p) return OPENCODE_SAFE_DEFAULT_MODEL

  const allowOverride = opts.allowOverride === true || diagnosticOverrideEnabled(p)
  if (allowOverride) return p

  const zenFreeAllowlist = opts.zenFreeAllowlist ?? [...OPENCODE_ZEN_FREE_MODELS]
  const candidates = opts.candidates
  const providers = opts.providers

  if (candidates && providers) {
    const er = evaluateModelEligibility({
      modelId: p,
      candidates,
      providers,
      zenFreeAllowlist,
      purpose: 'execute',
    })
    if (er.eligible) return p
    throw new ModelEligibilityError(
      `Model "${p}" is not eligible for ACP execute: ${er.errorCode ?? 'unknown'}`,
      {
        errorCode: er.errorCode ?? 'MODEL_SELECTION_UNVERIFIED',
        providerId: er.providerId,
        evidence: er.evidence,
      },
    )
  }

  // No eligibility context (discovery/spawn before catalog load): keep pin as-is.
  // Never remap to a different model — callers that have candidates must pass them.
  void zenFreeAllowlist
  return p
}

export interface OpenCodeAcpPrep {
  env: NodeJS.ProcessEnv
  /** Model written into isolated config (session default) */
  configModel: string
  /** Prefer NOT passing set_model when using config default only */
  passModelToAcp: boolean
  isolatedHome: string
  hint: string
}

/**
 * Build env + isolated config so `opencode acp` can start under ACP SDK 1.2.1.
 * Throws ModelEligibilityError when pin is ineligible (fail-closed).
 */
export function prepareOpenCodeAcpEnv(opts?: {
  baseEnv?: NodeJS.ProcessEnv
  /** Worker-pinned model id */
  model?: string | null
  /** When true, still pass model to createACPTool for set_model */
  forceSetModel?: boolean
  candidates?: WorkerModelOption[]
  providers?: Record<string, ProviderEvidence>
  zenFreeAllowlist?: string[]
  allowOverride?: boolean
}): OpenCodeAcpPrep {
  const base = opts?.baseEnv ?? process.env
  const realHome = base.HOME || process.env.HOME || tmpdir()
  const hasExplicitXdgConfig = Object.prototype.hasOwnProperty.call(base, 'XDG_CONFIG_HOME')
  const hasExplicitXdgData = Object.prototype.hasOwnProperty.call(base, 'XDG_DATA_HOME')
  const hasExplicitXdgCache = Object.prototype.hasOwnProperty.call(base, 'XDG_CACHE_HOME')
  const evidencePaths = resolveOpenCodeEvidencePaths({
    realHome,
    XDG_CONFIG_HOME: base.XDG_CONFIG_HOME,
    XDG_DATA_HOME: base.XDG_DATA_HOME,
    explicitXdgConfig: hasExplicitXdgConfig,
    explicitXdgData: hasExplicitXdgData,
  })
  const configModel = pickOpenCodeAcpModel({
    pinned: opts?.model,
    candidates: opts?.candidates,
    providers: opts?.providers,
    zenFreeAllowlist: opts?.zenFreeAllowlist,
    allowOverride: opts?.allowOverride,
  })

  const root = mkdtempSync(join(tmpdir(), 'router-oc-acp-'))
  const confDir = join(root, '.config', 'opencode')
  mkdirSync(confDir, { recursive: true })

  // No `server.port` — avoids ServeError when user has a fixed busy port in global config.
  // Project safe provider config for the selected model so "discoverable" stays "executable".
  const conf: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    model: configModel,
  }

  let hint = `OpenCode ACP isolated config model=${configModel}`
  if (opts?.model?.trim() && opts.model.trim() !== configModel) {
    hint += ` (override applied for pin "${opts.model}")`
  }

  try {
    const userConfPath = evidencePaths.disabledPaths[0]
    if (userConfPath && existsSync(userConfPath)) {
      const raw = JSON.parse(readFileSync(userConfPath, 'utf8')) as {
        model?: string
        server?: { port?: number }
        disabled_providers?: string[]
        provider?: Record<string, unknown>
        providers?: Record<string, unknown>
      }
      if (raw.server?.port) {
        hint += `; ignored user server.port=${raw.server.port}`
      }
      if (raw.disabled_providers?.length) {
        hint += `; user disabled_providers=${raw.disabled_providers.join(',')}`
        // Project disabled_providers so execute matches discovery evidence
        conf.disabled_providers = raw.disabled_providers
      }
      // Project only the selected provider's config (not full custom secrets dump)
      const providerId = configModel.includes('/')
        ? configModel.slice(0, configModel.indexOf('/'))
        : configModel
      const userProviders = raw.provider ?? raw.providers
      if (userProviders && typeof userProviders === 'object' && providerId in userProviders) {
        const entry = (userProviders as Record<string, unknown>)[providerId]
        if (entry && typeof entry === 'object') {
          // Strip npm tokens / secret-looking fields; keep baseURL / options needed for custom providers
          const safe: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
            if (/secret|token|apiKey|api_key|password|credential/i.test(k)) continue
            safe[k] = v
          }
          conf.provider = { [providerId]: safe }
          hint += `; projected provider config for ${providerId}`
        }
      }
    }
  } catch {
    /* ignore */
  }

  writeFileSync(join(confDir, 'opencode.json'), JSON.stringify(conf, null, 2), 'utf8')

  const env: NodeJS.ProcessEnv = {
    ...base,
    HOME: root,
    // Keep credentials / package cache from the real user install
    XDG_DATA_HOME: hasExplicitXdgData ? base.XDG_DATA_HOME : join(realHome, '.local/share'),
    XDG_CACHE_HOME: hasExplicitXdgCache ? base.XDG_CACHE_HOME : join(realHome, '.cache'),
    // Keep OpenCode from loading the original config a second time; use projected config only.
    XDG_CONFIG_HOME: join(root, '.config'),
    // Avoid inheriting a bad OPENCODE_CONFIG that reintroduces server.port
    OPENCODE_CONFIG: join(confDir, 'opencode.json'),
  }
  // Don't double-merge destructive content
  delete env.OPENCODE_CONFIG_CONTENT

  // Prefer letting OpenCode use config default — set_model with wrong ids breaks ACP.
  // Only pass model when it is a Zen free model we know is in configOptions.
  const passModelToAcp =
    opts?.forceSetModel === true ||
    (Boolean(opts?.model?.trim()) && isLikelyOpenCodeZenModel(opts!.model!.trim()))

  return {
    env,
    configModel,
    passModelToAcp,
    isolatedHome: root,
    hint,
  }
}
