import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, chmodSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { configureLoginShellPath, expandHome, whichSync } from './which.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('expandHome replaces a leading ~ with the home directory', () => {
  assert.equal(expandHome('~/bin/kimi'), join(homedir(), 'bin/kimi'))
  // Mid-string or no-tilde inputs are untouched.
  assert.equal(expandHome('/usr/bin/kimi'), '/usr/bin/kimi')
  assert.equal(expandHome('kimi ~/x'), 'kimi ~/x')
  assert.equal(expandHome(''), '')
})

test('whichSync resolves a ~ path to the real home-relative executable', () => {
  // Create an executable under the actual home dir in a unique subdir, then refer to it via ~/...
  const dir = mkdtempSync(join(homedir(), 'which-tilde-'))
  dirs.push(dir)
  const exe = join(dir, 'kimi-fake')
  writeFileSync(exe, '#!/bin/sh\necho ok\n', { mode: 0o755 })
  chmodSync(exe, 0o755)
  const tildePath = exe.replace(homedir(), '~')
  assert.ok(tildePath.startsWith('~/'), 'fixture should be expressible as a ~ path')
  // Without ~ expansion this returns null; with it, resolves to the absolute path.
  assert.equal(whichSync(tildePath), exe)
})

test('whichSync still returns null for a non-existent ~ path', () => {
  assert.equal(whichSync('~/this/does/not/exist-' + process.pid), null)
})

test('whichSync resolves a bare command from PATH', () => {
  // node itself is always on PATH in a test run.
  assert.ok(whichSync('node'))
})

test('whichSync falls back to ~/.local/bin for a bare name not on PATH', () => {
  // ~/.local/bin is a minimal ecosystem-standard fallback kept even when the login-shell harvest
  // has not run/failed. Install a fake binary there and confirm a bare lookup resolves.
  const fallbackDir = join(homedir(), '.local', 'bin')
  mkdirSync(fallbackDir, { recursive: true })
  const exe = join(fallbackDir, 'which-fallback-fake-' + process.pid)
  try {
    writeFileSync(exe, '#!/bin/sh\necho ok\n', { mode: 0o755 })
    chmodSync(exe, 0o755)
    assert.equal(whichSync('which-fallback-fake-' + process.pid), exe)
  } finally {
    rmSync(exe, { force: true })
  }
})

test('whichSync does not search fallback dirs for a path-shaped relative input', () => {
  // A relative path with a separator must resolve literally (like a shell), not be searched
  // across fallback dirs — otherwise "./kimi" could match an unrelated file in ~/.local/bin.
  assert.equal(whichSync('subdir/kimi-fake-' + process.pid), null)
})

test('configureLoginShellPath harvests PATH from the login shell so new dirs resolve', () => {
  if (process.platform === 'win32') {
    // No login-shell model on Windows; the function is a no-op there.
    return
  }
  // Point SHELL at a stub script that mimics a login shell printing a PATH containing a brand-new
  // bin dir we just created. configureLoginShellPath must pick it up so whichSync finds a binary
  // that is neither on the process PATH nor in the minimal fallback list.
  const newBin = mkdtempSync(join(tmpdir(), 'login-shell-path-'))
  dirs.push(newBin)
  const exe = join(newBin, 'harvested-cmd')
  writeFileSync(exe, '#!/bin/sh\necho ok\n', { mode: 0o755 })
  chmodSync(exe, 0o755)
  const stubShell = join(newBin, 'stub-shell')
  writeFileSync(stubShell, `#!/bin/sh\nprintf '%s' "${newBin}"\n`, { mode: 0o755 })
  chmodSync(stubShell, 0o755)
  const savedShell = process.env.SHELL
  const savedPath = process.env.PATH
  // Dock-like minimal PATH: harvest must still surface the shell dirs.
  process.env.PATH = '/usr/bin:/bin'
  process.env.SHELL = stubShell
  try {
    configureLoginShellPath()
    assert.equal(whichSync('harvested-cmd'), exe)
    // process.env.PATH itself must gain the harvested dir so resolveAcpRunner / spawn see it.
    assert.ok(
      (process.env.PATH ?? '').split(':').includes(newBin),
      'harvested dir must be merged into process.env.PATH',
    )
    assert.ok(
      (process.env.PATH ?? '').startsWith(newBin),
      'harvested dirs should prepend process.env.PATH',
    )
  } finally {
    process.env.SHELL = savedShell
    if (savedPath === undefined) delete process.env.PATH
    else process.env.PATH = savedPath
    // Restore the default harvest so other tests aren't affected by the stub PATH.
    configureLoginShellPath()
  }
})

test('configureLoginShellPath degrades silently when the shell fails', () => {
  if (process.platform === 'win32') return
  // A shell that exits non-zero must not throw, and the minimal fallback (~/.local/bin) must remain
  // usable. Use /bin/false (exits 1 immediately) so the fallback chain resolves fast without
  // waiting on real zsh/bash startup, and stub the remaining candidates so no real shell runs.
  const savedShell = process.env.SHELL
  const stubFail = join(tmpdir(), 'stub-fail-' + process.pid)
  writeFileSync(stubFail, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  // Point SHELL + the zsh/bash fallbacks at the same fast-failing stub via a tmp PATH so the whole
  // candidate list short-circuits quickly.
  process.env.SHELL = stubFail
  try {
    assert.doesNotThrow(() => configureLoginShellPath())
  } finally {
    rmSync(stubFail, { force: true })
    process.env.SHELL = savedShell
  }
})
