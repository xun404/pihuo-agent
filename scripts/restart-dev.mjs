#!/usr/bin/env node
import { execSync, spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const OWNER_LOCK = resolve(homedir(), '.config/pihuo-agent/data/acp-sessions.json.owner')

console.log('[restart] killing stale processes...')
try {
  execSync('pkill -9 -f Electron', { stdio: 'ignore' })
} catch {}
try {
  execSync('pkill -9 -f vite-electron', { stdio: 'ignore' })
} catch {}
try {
  execSync('pkill -9 -f "tsx watch"', { stdio: 'ignore' })
} catch {}
execSync('sleep 2', { stdio: 'ignore' })

for (const port of [5173, 4111, 8315]) {
  try {
    const pid = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' }).trim()
    if (pid) execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
  } catch {}
}

if (existsSync(OWNER_LOCK)) {
  rmSync(OWNER_LOCK)
  console.log('[restart] removed stale owner lock')
}

console.log('[restart] building...')
execSync('npm run build', { stdio: 'inherit' })
console.log('[restart] starting desktop with CDP...')

const child = spawn('npm', ['run', 'desktop'], { detached: true, stdio: 'ignore' })
child.unref()

console.log('[restart] waiting for services...')
await new Promise((r) => setTimeout(r, 14000))

try {
  const api = await fetch('http://127.0.0.1:4111/health')
  console.log(`[restart] API: ${api.status}`)
} catch {
  console.log('[restart] API: not ready')
}

try {
  const cdp = await fetch('http://127.0.0.1:8315/json/version')
  const v = await cdp.json()
  console.log(`[restart] CDP: ${v.Browser}`)
} catch {
  console.log('[restart] CDP: not ready')
}

console.log('[restart] done')
