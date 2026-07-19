/**
 * Resolve OpenCode model catalog from the real CLI (`opencode models`).
 *
 * ACP getAvailableModels under isolated config only sees the one default model,
 * so we must NOT list models inside prepareOpenCodeAcpEnv isolation.
 *
 * @see https://opencode.ai/docs/cli/#models
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { WorkerModelOption } from '@swarmdesk-agent/shared'
import { OPENCODE_ZEN_FREE_MODELS } from './opencode-acp-env.js'
import {
  resolveOpenCodeEvidencePaths,
  type OpenCodeEvidencePaths,
} from './opencode-evidence-paths.js'

export {
  resolveOpenCodeEvidencePaths,
  type OpenCodeEvidencePaths,
} from './opencode-evidence-paths.js'

export interface ListOpenCodeModelsOpts {
  /** Executable used by the worker (default: opencode) */
  command?: string
  env?: NodeJS.ProcessEnv
  cwd?: string
  timeoutMs?: number
  /** Prefer this model at the top of the list */
  pinnedModel?: string | null
}

/** provider/model id lines from `opencode models` stdout. */
export function parseOpenCodeModelsStdout(stdout: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('{') || t.startsWith('[') || t.startsWith('"')) continue
    // provider/model — allow nested openrouter/~anthropic/...
    if (!/^[a-zA-Z0-9_.@+-]+\/\S+$/.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    ids.push(t)
  }
  return ids
}

/**
 * Read OpenCode auth store provider IDs.
 * When `opts.xdgDataHome` is passed (including empty), do not fall back to HOME.
 */
export function readAuthProviderIds(
  realHome: string,
  opts?: { xdgDataHome?: string; explicitXdg?: boolean },
): Set<string> {
  const set = new Set<string>()
  // Explicit only when caller passes a string (including "") — undefined means use HOME fallback
  const explicit = opts?.explicitXdg === true || typeof opts?.xdgDataHome === 'string'
  const { authPaths } = resolveOpenCodeEvidencePaths({
    realHome,
    XDG_DATA_HOME: opts?.xdgDataHome,
    explicitXdgData: explicit,
  })
  for (const p of authPaths) {
    try {
      if (!existsSync(p)) {
        // Explicit XDG path missing → fail closed (do not try other paths)
        if (explicit) break
        continue
      }
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
      for (const k of Object.keys(raw)) {
        if (k && typeof k === 'string') set.add(k)
      }
      // First successfully-read file wins
      break
    } catch {
      // Corrupt explicit XDG → fail closed, do not fall through to HOME
      if (explicit) break
    }
  }
  // Zen free provider never needs auth entry
  set.add('opencode')
  return set
}

export function readDisabledProviders(
  realHome: string,
  opts?: { xdgConfigHome?: string; explicitXdg?: boolean },
): Set<string> {
  const set = new Set<string>()
  const explicit = opts?.explicitXdg === true || typeof opts?.xdgConfigHome === 'string'
  const { disabledPaths } = resolveOpenCodeEvidencePaths({
    realHome,
    XDG_CONFIG_HOME: opts?.xdgConfigHome,
    explicitXdgConfig: explicit,
  })
  for (const p of disabledPaths) {
    try {
      if (!existsSync(p)) {
        if (explicit) break
        continue
      }
      const raw = JSON.parse(readFileSync(p, 'utf8')) as {
        disabled_providers?: string[]
      }
      for (const d of raw.disabled_providers ?? []) {
        if (typeof d === 'string' && d.trim()) set.add(d.trim())
      }
      break
    } catch {
      if (explicit) break
    }
  }
  return set
}

function providerOf(modelId: string): string {
  const i = modelId.indexOf('/')
  return i > 0 ? modelId.slice(0, i) : modelId
}

/**
 * Sort for the Workers dropdown:
 * 1. pinned
 * 2. Zen free (opencode/*)
 * 3. providers with local auth (except openrouter)
 * 4. openrouter last among usable
 * 5. everything else
 * Disabled providers sink to the bottom (still listed so user can pick after re-enable).
 */
export function sortOpenCodeModelIds(
  ids: string[],
  opts?: {
    pinnedModel?: string | null
    authProviders?: Set<string>
    disabledProviders?: Set<string>
  },
): string[] {
  const pin = opts?.pinnedModel?.trim()
  const auth = opts?.authProviders ?? new Set<string>(['opencode'])
  const disabled = opts?.disabledProviders ?? new Set<string>()

  const rank = (id: string): number => {
    if (pin && id === pin) return 0
    const p = providerOf(id)
    if (disabled.has(p)) return 900
    if (p === 'opencode') return 10
    if (auth.has(p) && p !== 'openrouter') return 20
    if (p === 'openrouter' && auth.has(p)) return 50
    if (auth.has(p)) return 40
    return 80
  }

  return [...ids].sort((a, b) => {
    const d = rank(a) - rank(b)
    if (d !== 0) return d
    return a.localeCompare(b)
  })
}

function prettyName(modelId: string): string {
  const p = providerOf(modelId)
  const rest = modelId.slice(p.length + 1)
  return `${p} / ${rest}`
}

export function zenFreeFallbackModels(): WorkerModelOption[] {
  return OPENCODE_ZEN_FREE_MODELS.map((modelId) => ({
    modelId,
    name: prettyName(modelId),
  }))
}

/**
 * Run `opencode models` with the **real** user env (auth + providers).
 */
export function listOpenCodeModelsViaCli(opts?: ListOpenCodeModelsOpts): {
  ok: boolean
  models: WorkerModelOption[]
  error?: string
  source: 'cli' | 'fallback'
} {
  const command = opts?.command?.trim() || 'opencode'
  const timeoutMs = opts?.timeoutMs ?? 45_000
  const realHome = opts?.env?.HOME || process.env.HOME || process.env.USERPROFILE || homedir()

  // Real env — do NOT use isolated ACP HOME here
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts?.env,
    HOME: realHome,
  }
  // Avoid injecting a minimal OPENCODE_CONFIG that hides providers
  delete env.OPENCODE_CONFIG
  delete env.OPENCODE_CONFIG_CONTENT

  try {
    const r = spawnSync(command, ['models'], {
      encoding: 'utf8',
      timeout: timeoutMs,
      env,
      cwd: opts?.cwd || process.cwd(),
      maxBuffer: 16 * 1024 * 1024,
    })
    if (r.error) {
      return {
        ok: false,
        models: [],
        error: r.error.message,
        source: 'cli',
      }
    }
    if (r.status !== 0) {
      const err = (r.stderr || r.stdout || `exit ${r.status}`).trim().slice(0, 400)
      return {
        ok: false,
        models: [],
        error: err || `opencode models failed (exit ${r.status})`,
        source: 'cli',
      }
    }
    const ids = parseOpenCodeModelsStdout(r.stdout || '')
    if (ids.length === 0) {
      return {
        ok: false,
        models: [],
        error: 'opencode models returned no model ids',
        source: 'cli',
      }
    }
    const sorted = sortOpenCodeModelIds(ids, {
      pinnedModel: opts?.pinnedModel,
      authProviders: readAuthProviderIds(realHome, {
        xdgDataHome: env.XDG_DATA_HOME,
        explicitXdg: Object.prototype.hasOwnProperty.call(env, 'XDG_DATA_HOME'),
      }),
      disabledProviders: readDisabledProviders(realHome, {
        xdgConfigHome: env.XDG_CONFIG_HOME,
        explicitXdg: Object.prototype.hasOwnProperty.call(env, 'XDG_CONFIG_HOME'),
      }),
    })
    return {
      ok: true,
      models: sorted.map((modelId) => ({
        modelId,
        name: prettyName(modelId),
      })),
      source: 'cli',
    }
  } catch (e) {
    return {
      ok: false,
      models: [],
      error: e instanceof Error ? e.message : String(e),
      source: 'cli',
    }
  }
}
