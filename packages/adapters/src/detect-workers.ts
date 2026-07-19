/**
 * Auto-detect ACP-capable CLIs installed on this machine.
 * Catalog aligns with common ACP clients (VS Code ACP Client, Zed, Mastra).
 *
 * @see https://agentclientprotocol.com
 * @see https://opencode.ai/docs/acp/
 */

import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type {
  WorkerCapability,
  WorkerKind,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { WORKER_PRESETS } from './presets.js'

function rolesToCapabilities(roles: WorkerRole[]): WorkerCapability[] {
  const map: Record<WorkerRole, WorkerCapability> = {
    plan: 'plan',
    coder: 'code-edit',
    review: 'review',
    test: 'test',
    research: 'research',
    general: 'general',
  }
  return [...new Set(roles.map((r) => map[r]))]
}

export interface AcpDetectCandidate {
  kind: Exclude<WorkerKind, 'custom'>
  name: string
  /** True if a usable binary / runner was found on PATH */
  installed: boolean
  /** How we detected it */
  detectVia: 'path' | 'npx' | 'missing'
  /** Absolute or command name found (when installed) */
  resolvedCommand?: string
  /** Command used for ACP spawn */
  command: string
  args: string[]
  primaryRole: WorkerRole
  roles: WorkerRole[]
  description: string
  installHint: string
  docsUrl?: string
}

function pathDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
}

/** Synchronous which(1)-like lookup */
export function whichSync(cmd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!cmd) return undefined
  if (isAbsolute(cmd)) {
    try {
      accessSync(cmd, fsConstants.X_OK)
      return cmd
    } catch {
      return undefined
    }
  }
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : ['']
  for (const dir of pathDirs(env)) {
    for (const ext of exts) {
      const full = join(dir, cmd + ext)
      try {
        accessSync(full, fsConstants.X_OK)
        return full
      } catch {
        /* try next */
      }
    }
  }
  return undefined
}

function spawnQuiet(
  cmd: string,
  args: string[],
  timeoutMs = 2500,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: process.env,
    })
    let stdout = ''
    child.stdout?.on('data', (c: Buffer) => {
      if (stdout.length < 2000) stdout += c.toString('utf8')
    })
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve({ ok: false, stdout })
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, stdout })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 || code === 1, stdout }) // many CLIs return 1 for --help
    })
  })
}

/**
 * Detect presence of known ACP agents on this host.
 */
export async function detectAcpWorkers(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AcpDetectCandidate[]> {
  const npx = whichSync('npx', env)
  const claude = whichSync('claude', env)
  const codex = whichSync('codex', env)
  const opencode = whichSync('opencode', env)

  const out: AcpDetectCandidate[] = []

  // Claude Code — ACP via official adapter; detect via `claude` or npx
  {
    const preset = WORKER_PRESETS.claude
    const installed = Boolean(claude || npx)
    out.push({
      kind: 'claude',
      name: preset.name,
      installed,
      detectVia: claude ? 'path' : npx ? 'npx' : 'missing',
      resolvedCommand: claude ?? npx,
      command: preset.command,
      args: [...preset.args],
      primaryRole: preset.primaryRole,
      roles: [...preset.roles],
      description: preset.description ?? '',
      installHint: claude
        ? 'Claude Code detected on PATH; ACP uses @agentclientprotocol/claude-agent-acp via npx.'
        : npx
          ? 'Node/npx available. Claude ACP adapter will download on first use. Prefer installing Claude Code for auth.'
          : 'Install Claude Code CLI, or ensure Node.js/npx is on PATH.',
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    })
  }

  // Codex — adapter via npx; detect via `codex` binary presence
  {
    const preset = WORKER_PRESETS.codex
    const installed = Boolean(codex || npx)
    out.push({
      kind: 'codex',
      name: preset.name,
      installed,
      detectVia: codex ? 'path' : npx ? 'npx' : 'missing',
      resolvedCommand: codex ?? npx,
      command: preset.command,
      args: [...preset.args],
      primaryRole: preset.primaryRole,
      roles: [...preset.roles],
      description: preset.description ?? '',
      installHint: codex
        ? 'Codex CLI detected. ACP uses @zed-industries/codex-acp via npx.'
        : npx
          ? 'Node/npx available. Codex ACP adapter downloads on first use.'
          : 'Install Codex CLI (`npm i -g @openai/codex`) or ensure npx is on PATH.',
      docsUrl: 'https://github.com/openai/codex',
    })
  }

  // OpenCode — native `opencode acp`
  {
    const preset = WORKER_PRESETS.opencode
    const installed = Boolean(opencode)
    const resolved = opencode
    // Light version probe if present
    if (opencode) {
      const v = await spawnQuiet(opencode, ['--version'], 2000)
      if (!v.ok && !v.stdout) {
        /* still count as installed if path exists */
      }
    }
    out.push({
      kind: 'opencode',
      name: preset.name,
      installed,
      detectVia: installed ? 'path' : 'missing',
      resolvedCommand: resolved,
      command: 'opencode',
      args: ['acp'],
      primaryRole: preset.primaryRole,
      roles: [...preset.roles],
      description: preset.description ?? '',
      installHint: installed
        ? 'OpenCode detected. Uses native `opencode acp`. Configure a working model in OpenCode or set worker model in UI.'
        : 'Install OpenCode: https://opencode.ai/docs — then re-run detect.',
      docsUrl: 'https://opencode.ai/docs/acp/',
    })
  }

  return out
}

export interface ApplyDetectResult {
  candidates: AcpDetectCandidate[]
  workers: WorkerRegistration[]
  /** Newly enabled because installed */
  enabled: string[]
  /** Marked missing / disabled because not installed (only when autoDisableMissing) */
  disabled: string[]
  recommended: AcpDetectCandidate[]
}

/**
 * Merge detection into the worker list:
 * - Prefer native paths when found
 * - Enable installed workers; optionally disable missing ones
 * - Keep custom workers untouched
 */
export function applyDetectionToWorkers(
  existing: WorkerRegistration[],
  candidates: AcpDetectCandidate[],
  opts?: { autoDisableMissing?: boolean; createMissing?: boolean },
): ApplyDetectResult {
  const autoDisableMissing = opts?.autoDisableMissing ?? false
  const createMissing = opts?.createMissing ?? true
  const byKind = new Map(candidates.map((c) => [c.kind, c]))
  const enabled: string[] = []
  const disabled: string[] = []
  const next = existing.map((w) => {
    if (w.kind === 'custom') return w
    const c = byKind.get(w.kind as Exclude<WorkerKind, 'custom'>)
    if (!c) return w
    const updated: WorkerRegistration = {
      ...w,
      command: c.command,
      args: c.args,
      description: w.description || c.description,
    }
    if (c.installed) {
      if (!w.enabled) {
        updated.enabled = true
        enabled.push(w.id)
      }
      // don't overwrite healthy with missing; health refresh is separate
    } else if (autoDisableMissing && w.enabled) {
      updated.enabled = false
      updated.health = 'missing'
      disabled.push(w.id)
    } else if (!c.installed) {
      updated.health = w.health === 'healthy' ? 'unknown' : w.health
    }
    return updated
  })

  // Ensure a row exists for each known kind when createMissing
  if (createMissing) {
    for (const c of candidates) {
      if (next.some((w) => w.kind === c.kind)) continue
      // deferred: caller assigns id via store
      next.push({
        id: `detect-${c.kind}`,
        name: c.name,
        kind: c.kind,
        command: c.command,
        args: c.args,
        primaryRole: c.primaryRole,
        roles: c.roles,
        capabilities: rolesToCapabilities(c.roles),
        description: c.description,
        enabled: c.installed,
        scope: 'global',
        health: c.installed ? 'unknown' : 'missing',
      })
      if (c.installed) enabled.push(`detect-${c.kind}`)
    }
  }

  const recommended = candidates.filter((c) => c.installed)

  return { candidates, workers: next, enabled, disabled, recommended }
}
