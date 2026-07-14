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
 *
 * @see https://opencode.ai/docs/acp/
 * @see https://opencode.ai/docs/troubleshooting/
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/**
 * Pick a model id safe for ACP:
 * - Keep worker pin if it looks like Zen free or env override
 * - Otherwise fall back to safe default (avoid disabled custom providers)
 */
export function pickOpenCodeAcpModel(pinned?: string | null): string {
  const p = pinned?.trim()
  if (p && isLikelyOpenCodeZenModel(p)) return p
  if (p && process.env.OPENCODE_ALLOW_CUSTOM_MODEL === '1') return p
  // Custom providers (opencode-go/*, glm-coding-plan/*) often fail under ACP
  // when disabled or missing auth in the isolated session.
  if (p && !p.includes('glm-coding-plan') && !p.includes('disabled')) {
    // still allow opencode-go if user explicitly set OPENCODE_MODEL or pin + allow
    if (p.startsWith('opencode-go/') && process.env.OPENCODE_ALLOW_GO === '1') return p
  }
  return OPENCODE_SAFE_DEFAULT_MODEL
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
 */
export function prepareOpenCodeAcpEnv(opts?: {
  baseEnv?: NodeJS.ProcessEnv
  /** Worker-pinned model id */
  model?: string | null
  /** When true, still pass model to createACPTool for set_model */
  forceSetModel?: boolean
}): OpenCodeAcpPrep {
  const base = opts?.baseEnv ?? process.env
  const realHome = base.HOME || process.env.HOME || tmpdir()
  const configModel = pickOpenCodeAcpModel(opts?.model)

  const root = mkdtempSync(join(tmpdir(), 'router-oc-acp-'))
  const confDir = join(root, '.config', 'opencode')
  mkdirSync(confDir, { recursive: true })

  // No `server.port` — avoids ServeError when user has a fixed busy port in global config
  const conf: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    model: configModel,
  }
  writeFileSync(join(confDir, 'opencode.json'), JSON.stringify(conf, null, 2), 'utf8')

  // Optional: surface why we overrode
  let hint = `OpenCode ACP isolated config model=${configModel}`
  if (opts?.model && opts.model !== configModel) {
    hint += ` (worker pin "${opts.model}" remapped — set OPENCODE_ALLOW_GO=1 or OPENCODE_ALLOW_CUSTOM_MODEL=1 to force)`
  }

  // Read user disabled_providers only for logging
  try {
    const userConfPath = join(realHome, '.config/opencode/opencode.json')
    if (existsSync(userConfPath)) {
      const raw = JSON.parse(readFileSync(userConfPath, 'utf8')) as {
        model?: string
        server?: { port?: number }
        disabled_providers?: string[]
      }
      if (raw.server?.port) {
        hint += `; ignored user server.port=${raw.server.port}`
      }
      if (raw.disabled_providers?.length) {
        hint += `; user disabled_providers=${raw.disabled_providers.join(',')}`
      }
    }
  } catch {
    /* ignore */
  }

  const env: NodeJS.ProcessEnv = {
    ...base,
    HOME: root,
    // Keep credentials / package cache from the real user install
    XDG_DATA_HOME: base.XDG_DATA_HOME || join(realHome, '.local/share'),
    XDG_CACHE_HOME: base.XDG_CACHE_HOME || join(realHome, '.cache'),
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
