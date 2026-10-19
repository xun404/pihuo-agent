/**
 * ACP authentication helpers: auth_required detection, method sanitization,
 * agent authenticate flow helpers. No secret values in public surfaces.
 */
import { RequestError } from '@agentclientprotocol/sdk'

export type SanitizedAuthMethod = {
  id: string
  name?: string
  description?: string
  type: 'agent' | 'terminal' | 'env_var' | 'unsupported'
  /** Env var names only (never values). */
  envVarNames?: string[]
  /** Terminal auth args from method (no shell). */
  terminalArgs?: string[]
  /** Non-sensitive env keys advertised for terminal auth. */
  terminalEnvKeys?: string[]
  /** Bounded non-sensitive env entries for Owner-materialized terminal auth. */
  terminalEnv?: Record<string, string>
  link?: string
}

const AUTH_LIMITS = {
  methods: 16,
  idBytes: 128,
  nameBytes: 128,
  descriptionBytes: 512,
  linkBytes: 2_048,
  terminalArgs: 32,
  terminalArgBytes: 512,
  envEntries: 32,
  envNameBytes: 128,
  envValueBytes: 512,
  totalBytes: 16_384,
} as const

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u
const SECRET_LOOKING_NAME =
  /(?:^|_)(?:AUTH|COOKIE|CREDENTIAL|KEY|PASS(?:WORD)?|SECRET|TOKEN)(?:_|$)/iu
const SECRET_LOOKING_VALUE =
  /(?:bearer\s+|-----BEGIN|api[_-]?key|password|secret|token|credential|\b(?:sk|rk|pk|ghp|github_pat)-[A-Za-z0-9_-]{16,})/iu
const CONTROL_ENV_NAMES = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'BASH_ENV',
  'ENV',
  'CDPATH',
  'GLOBIGNORE',
  'SHELLOPTS',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'PYTHONINSPECT',
  'RUBYOPT',
  'RUBYLIB',
  'PERL5OPT',
  'PERL5LIB',
  'NPM_CONFIG_USERCONFIG',
  'NPM_CONFIG_PREFIX',
  'COREPACK_HOME',
])
const CONTROL_ENV_PREFIXES = [
  'PIHUO_AGENT_',
  'MASTRA_',
  'ELECTRON_',
  'LD_',
  'DYLD_',
  'NPM_CONFIG_',
  'YARN_',
  'PNPM_',
  'PYTHON',
  'RUBY',
  'PERL',
  'GEM_',
  'BUNDLE_',
] as const
const TERMINAL_ENV_ALLOWLIST = new Set([
  'CI',
  'TERM',
  'COLORTERM',
  'LANG',
  'LANGUAGE',
  'TZ',
  'NO_COLOR',
  'FORCE_COLOR',
])

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function safeText(value: unknown, maxBytes: number, trim = false): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = trim ? value.trim() : value
  if (!text || CONTROL_CHARACTERS.test(text) || byteLength(text) > maxBytes) return undefined
  return text
}

function isValidEnvName(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    ENV_NAME.test(name) &&
    byteLength(name) <= AUTH_LIMITS.envNameBytes &&
    !CONTROL_ENV_NAMES.has(upper) &&
    !CONTROL_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  )
}

function isAllowedTerminalEnvName(name: string): boolean {
  const upper = name.toUpperCase()
  return isValidEnvName(name) && (TERMINAL_ENV_ALLOWLIST.has(upper) || upper.startsWith('LC_'))
}

function unsupportedMethod(id: string, name?: string, description?: string): SanitizedAuthMethod {
  return {
    id,
    name: name ?? id,
    description: description ?? 'Unsupported authentication method',
    type: 'unsupported',
  }
}

export function isAuthRequiredError(error: unknown): boolean {
  if (!(error instanceof RequestError)) return false
  if (error.code !== -32000) return false
  const data = error.data
  if (data == null || typeof data !== 'object') return false
  const reason = (data as Record<string, unknown>).reason
  return reason === 'auth_required'
}

export function isRequestError(error: unknown): error is RequestError {
  return error instanceof RequestError
}

/**
 * Sanitize initialize authMethods for Store / API / UI.
 * Unknown method shapes become type=unsupported (display only; never auto-run).
 */
export function sanitizeAuthMethods(
  methods: readonly unknown[] | undefined | null,
): SanitizedAuthMethod[] {
  if (!methods || methods.length === 0) return []
  const boundedMethods = methods.slice(0, AUTH_LIMITS.methods)
  const idCounts = new Map<string, number>()
  for (const raw of boundedMethods) {
    const id =
      raw && typeof raw === 'object'
        ? safeText((raw as { id?: unknown }).id, AUTH_LIMITS.idBytes, true)
        : undefined
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }
  const out: SanitizedAuthMethod[] = []
  let totalBytes = 0
  for (const raw of boundedMethods) {
    if (!raw || typeof raw !== 'object') continue
    const id = safeText((raw as { id?: unknown }).id, AUTH_LIMITS.idBytes, true) ?? ''
    if (!id) continue
    const rawName = (raw as { name?: unknown }).name
    const rawDescription = (raw as { description?: unknown }).description
    const name = safeText(rawName, AUTH_LIMITS.nameBytes)
    const description = safeText(rawDescription, AUTH_LIMITS.descriptionBytes)
    const type = (raw as { type?: unknown }).type
    let candidate: SanitizedAuthMethod

    if (
      (typeof rawName === 'string' && name === undefined) ||
      (typeof rawDescription === 'string' && rawDescription.length > 0 && description === undefined)
    ) {
      candidate = unsupportedMethod(id)
    } else if (type === 'env_var') {
      const rawVars = (raw as { vars?: unknown }).vars
      const rawLink = (raw as { link?: unknown }).link
      let invalid = !Array.isArray(rawVars) || rawVars.length > AUTH_LIMITS.envEntries
      const envVarNames: string[] = []
      if (Array.isArray(rawVars)) {
        for (const variable of rawVars.slice(0, AUTH_LIMITS.envEntries)) {
          const envName =
            variable && typeof variable === 'object'
              ? safeText((variable as { name?: unknown }).name, AUTH_LIMITS.envNameBytes, true)
              : undefined
          if (!envName || !isValidEnvName(envName)) {
            invalid = true
            continue
          }
          envVarNames.push(envName)
        }
      }

      let link: string | undefined
      if (rawLink !== undefined && rawLink !== null) {
        link = safeText(rawLink, AUTH_LIMITS.linkBytes)
        if (link) {
          try {
            const parsed = new URL(link)
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') invalid = true
          } catch {
            invalid = true
          }
        } else {
          invalid = true
        }
      }

      candidate = invalid
        ? unsupportedMethod(id, name, description)
        : { id, name, description, type: 'env_var', envVarNames, link }
    } else if (type === 'terminal') {
      const rawArgs = (raw as { args?: unknown }).args
      const rawEnv = (raw as { env?: unknown }).env
      let invalid = rawArgs !== undefined && !Array.isArray(rawArgs)
      const terminalArgs: string[] = []
      if (Array.isArray(rawArgs)) {
        if (rawArgs.length > AUTH_LIMITS.terminalArgs) invalid = true
        for (const value of rawArgs.slice(0, AUTH_LIMITS.terminalArgs)) {
          const arg = safeText(value, AUTH_LIMITS.terminalArgBytes)
          if (!arg) {
            invalid = true
            continue
          }
          terminalArgs.push(arg)
        }
      }

      const terminalEnv: Record<string, string> = {}
      if (
        rawEnv !== undefined &&
        (rawEnv === null || typeof rawEnv !== 'object' || Array.isArray(rawEnv))
      ) {
        invalid = true
      } else if (rawEnv && typeof rawEnv === 'object') {
        let count = 0
        for (const key of Object.keys(rawEnv)) {
          count += 1
          if (count > AUTH_LIMITS.envEntries) {
            invalid = true
            break
          }
          const value = (rawEnv as Record<string, unknown>)[key]
          const safeValue = safeText(value, AUTH_LIMITS.envValueBytes)
          if (
            !isAllowedTerminalEnvName(key) ||
            SECRET_LOOKING_NAME.test(key) ||
            !safeValue ||
            SECRET_LOOKING_VALUE.test(safeValue)
          ) {
            invalid = true
            continue
          }
          terminalEnv[key] = safeValue
        }
      }

      candidate = invalid
        ? unsupportedMethod(id, name, description)
        : {
            id,
            name,
            description,
            type: 'terminal',
            terminalArgs,
            terminalEnvKeys: Object.keys(terminalEnv),
            terminalEnv,
          }
    } else if (type === undefined || type === null || type === 'agent') {
      candidate = { id, name, description, type: 'agent' }
    } else {
      candidate = unsupportedMethod(id, name, description)
    }

    if ((idCounts.get(id) ?? 0) > 1) {
      candidate = unsupportedMethod(id, name, 'Duplicate authentication method ID')
    }

    const candidateBytes = byteLength(JSON.stringify(candidate))
    if (totalBytes + candidateBytes > AUTH_LIMITS.totalBytes) {
      candidate = unsupportedMethod(id, name, description)
    }
    const finalBytes = byteLength(JSON.stringify(candidate))
    if (totalBytes + finalBytes > AUTH_LIMITS.totalBytes) break
    totalBytes += finalBytes
    out.push(candidate)
  }
  return out
}

/** Public auth method projection for Worker.capabilitySummary */
export function toPublicAuthMethodSummary(
  methods: SanitizedAuthMethod[],
): Array<{ id: string; name?: string; description?: string; type: string }> {
  return methods.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    type: m.type,
  }))
}
