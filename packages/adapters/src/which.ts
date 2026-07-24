import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

/** Expand a leading `~` to the user's home directory. No-op for other inputs. */
export function expandHome(command: string): string {
  return command.replace(/^~/, homedir())
}

const HOME = homedir()

/**
 * Minimal language-ecosystem standard dirs kept as a last-resort fallback, used only when the
 * login-shell PATH harvest also fails. These two are near-universal on Unix (pipx/pip → ~/.local/bin,
 * cargo → ~/.cargo/bin). Everything else is expected to come from the user's shell config.
 */
const MINIMAL_FALLBACK_DIRS = [join(HOME, '.local', 'bin'), join(HOME, '.cargo', 'bin')]

/**
 * Extra directories searched when a bare command is not on the process PATH. Populated once at API
 * boot from the user's login+interactive shell so ~/.zshrc / ~/.bashrc PATH additions are honored
 * even though the server is a non-interactive process. Falls back to MINIMAL_FALLBACK_DIRS.
 */
let extraPathDirs: string[] = [...MINIMAL_FALLBACK_DIRS]

function detectDefaultShell(): string {
  // Prefer an explicit $SHELL (the caller's notion of their shell, and the testable knob), then
  // the system record, then a platform default.
  if (process.env.SHELL) return process.env.SHELL
  try {
    const { shell } = userInfo()
    if (shell) return shell
  } catch {
    // userInfo() can throw on exotic platforms; fall through to platform defaults.
  }
  if (process.platform === 'darwin') return '/bin/zsh'
  return '/bin/sh'
}

/**
 * Run a login+interactive shell once and harvest its $PATH into {@link extraPathDirs}. This is the
 * sindresorhus/shell-env algorithm, trimmed to PATH-only: it mirrors what the user's terminal sees
 * (sourcing ~/.zshrc etc.) so binaries like `kimi`, `opencode` resolve the same way they do in the
 * shell. Call once at API boot; never per-request (it spawns a shell).
 *
 * Silently degrades: Windows has no login-shell concept, and any failure (missing shell, timeout,
 * empty output) leaves the existing fallback dirs in place. Must never throw — boot must not break.
 */
export function configureLoginShellPath(): void {
  // Windows has no login-shell/PATH-sourcing model; rely on the process PATH + fallback dirs.
  if (process.platform === 'win32') return

  // Suppress oh-my-zsh auto-update and tmux autostart so heavy zsh configs don't hang or fork.
  const env = {
    ...process.env,
    DISABLE_AUTO_UPDATE: 'true',
    ZSH_TMUX_AUTOSTART: 'false',
    ZSH_TMUX_AUTOSTARTED: 'true',
  }
  const shell = detectDefaultShell()
  const result = spawnSync(shell, ['-ilc', 'printf %s "$PATH"'], {
    env,
    encoding: 'utf8',
    timeout: 4000,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status === 0 && result.stdout) {
    const dirs = result.stdout
      .split(delimiter)
      .map((d) => d.trim())
      .filter((d) => d.length > 0 && existsSync(d))
    if (dirs.length > 0) {
      extraPathDirs = Array.from(new Set(dirs))
      return
    }
  }
  // Shell failed or produced nothing usable: keep the existing fallback dirs (do not clear).
}

/** Resolve an executable from PATH without coupling callers to Worker discovery. */
export function whichSync(command: string): string | null {
  // Expand a leading `~` so "~/bin/kimi" resolves like a shell would; Node itself never expands it.
  const candidate = expandHome(command.trim())
  if (!candidate) return null

  // An absolute (or ~ -expanded) path resolves only to its literal location.
  if (isAbsolute(candidate)) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      return null
    }
  }

  // Directories to search: the process PATH, then the login-shell/fallback dirs for a bare name.
  // Path-shaped relative inputs (containing a separator) only search PATH, mirroring shell behavior.
  const isBareName = !candidate.includes('/')
  const dirs = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .concat(isBareName ? extraPathDirs : [])

  for (const directory of dirs) {
    if (!existsSync(directory)) continue
    const path = join(directory, candidate)
    try {
      accessSync(path, constants.X_OK)
      return path
    } catch {
      // Continue searching.
    }
  }
  return null
}
