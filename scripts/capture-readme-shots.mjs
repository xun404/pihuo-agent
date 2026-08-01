#!/usr/bin/env node
/**
 * Capture README / feature-wall screenshots from a running SwarmDesk desktop (CDP).
 *
 * Prerequisite:
 *   npm run desktop   # CDP :8315, API :4111
 *
 * Usage:
 *   node scripts/capture-readme-shots.mjs --locale en
 *   node scripts/capture-readme-shots.mjs --locale zh --out docs/assets/zh
 *   node scripts/capture-readme-shots.mjs --out docs/assets
 *
 * Seeds docs/demo/swarmdesk-showcase via POST /api/demo/seed, then drives the UI.
 * Default: locale=en → docs/assets ; locale=zh → docs/assets/zh
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1'
const CDP_PORT = process.env.CDP_PORT || '8315'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

const LOCALE = (argValue('--locale') || process.env.CAPTURE_LOCALE || 'en').startsWith('zh')
  ? 'zh'
  : 'en'
const OUT = argValue('--out')
  ? resolve(argValue('--out'))
  : LOCALE === 'zh'
    ? join(ROOT, 'docs/assets/zh')
    : join(ROOT, 'docs/assets')

const FEATURE = join(OUT, 'feature-wall')
console.log(`capture locale=${LOCALE} out=${OUT}`)

let WebSocketImpl
if (typeof WebSocket !== 'undefined') WebSocketImpl = WebSocket
else WebSocketImpl = (await import('ws')).WebSocket

let msgId = 0
const pending = new Map()

function send(ws, method, params = {}) {
  const id = ++msgId
  return new Promise((resolveP, reject) => {
    pending.set(id, { resolve: resolveP, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function getPageTarget() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`)
  const list = await res.json()
  const page =
    list.find((t) => t.type === 'page' && t.title !== 'DevTools') ??
    list.find((t) => t.type === 'page')
  if (!page) throw new Error('No CDP page target — is `npm run desktop` running with CDP :8315?')
  return page
}

async function evalInPage(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.result?.exceptionDetails) {
    const msg = r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text
    throw new Error(msg || 'eval failed')
  }
  return r.result?.result?.value
}

async function screenshot(ws, filePath, { clip } = {}) {
  mkdirSync(dirname(filePath), { recursive: true })
  const params = { format: 'png', fromSurface: true }
  if (clip) {
    params.clip = { ...clip, scale: 1 }
  }
  const r = await send(ws, 'Page.captureScreenshot', params)
  const b64 = r.result?.data
  if (!b64) throw new Error(`screenshot failed for ${filePath}`)
  writeFileSync(filePath, Buffer.from(b64, 'base64'))
  console.log('wrote', filePath)
}

async function main() {
  mkdirSync(FEATURE, { recursive: true })
  const page = await getPageTarget()
  const ws = new WebSocketImpl(page.webSocketDebuggerUrl)
  await new Promise((r, rej) => {
    ws.addEventListener('open', r)
    ws.addEventListener('error', rej)
  })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).resolve(m)
      pending.delete(m.id)
    }
  })

  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')

  // Set UI + server locale first so seed titles and chrome match the README language.
  const localeResult = await evalInPage(
    ws,
    `(async () => {
      const tok = await window.routerAgents?.getDesktopToken?.();
      const base = window.routerAgents?.apiBase || 'http://127.0.0.1:4111';
      const h = { 'Content-Type': 'application/json' };
      if (tok) {
        h.Authorization = 'Bearer ' + tok;
        h['X-SwarmDesk-Agent-Desktop-Token'] = tok;
      }
      const r = await fetch(base + '/api/locale', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ locale: ${JSON.stringify(LOCALE)} }),
      });
      const j = await r.json().catch(() => ({}));
      // Also flip client I18n if the provider is already mounted
      try {
        localStorage.setItem('swarmdesk-agent.locale', ${JSON.stringify(LOCALE)});
      } catch {}
      return { status: r.status, locale: j.locale, err: j.error };
    })()`,
  )
  console.log('locale', localeResult)
  // Reload so React I18nProvider picks up localStorage locale
  await evalInPage(
    ws,
    `(() => {
      try { localStorage.setItem('swarmdesk-agent.locale', ${JSON.stringify(LOCALE)}); } catch {}
      location.reload();
      return true;
    })()`,
  )
  await sleep(3000)

  // Seed showcase project + chat history (token optional when API runs with DESKTOP_AUTH=0)
  const seed = await evalInPage(
    ws,
    `(async () => {
      const tok = await window.routerAgents?.getDesktopToken?.();
      const base = window.routerAgents?.apiBase || 'http://127.0.0.1:4111';
      const h = { 'Content-Type': 'application/json' };
      if (tok) {
        h.Authorization = 'Bearer ' + tok;
        h['X-SwarmDesk-Agent-Desktop-Token'] = tok;
      }
      // Ensure locale stuck after reload
      await fetch(base + '/api/locale', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ locale: ${JSON.stringify(LOCALE)} }),
      });
      const r = await fetch(base + '/api/demo/seed', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ seedMemory: true }),
      });
      const j = await r.json();
      return {
        status: r.status,
        projectId: j.project?.id,
        sessionId: j.session?.id,
        title: j.session?.title,
        showcaseRoot: j.showcaseRoot,
        memorySeeded: j.memorySeeded,
        err: j.error,
      };
    })()`,
  )
  console.log('seed', seed)
  if (seed?.status !== 200) throw new Error('demo seed failed: ' + JSON.stringify(seed))

  // Refresh renderer snapshot / activate
  await evalInPage(
    ws,
    `(async () => {
      document.querySelector('.settings-back')?.click();
      await new Promise(r => setTimeout(r, 200));
      const tok = await window.routerAgents?.getDesktopToken?.();
      const base = window.routerAgents?.apiBase || 'http://127.0.0.1:4111';
      const h = {};
      if (tok) {
        h.Authorization = 'Bearer ' + tok;
        h['X-SwarmDesk-Agent-Desktop-Token'] = tok;
      }
      await fetch(base + '/api/sessions/${seed.sessionId}/activate', { method: 'POST', headers: h });
      // Nudge app to re-fetch snapshot (settings-closed is used after leaving settings)
      window.dispatchEvent(new Event('swarmdesk-agent:settings-closed'));
      window.dispatchEvent(new Event('focus'));
      return true;
    })()`,
  )
  await sleep(1000)
  await sleep(600)

  // Select seeded session (match EN or ZH title from seed)
  for (let attempt = 0; attempt < 3; attempt++) {
    await evalInPage(
      ws,
      `(() => {
        const title = ${JSON.stringify(seed.title || '')};
        const row = [...document.querySelectorAll('.sess, .session-item, [data-session-id]')]
          .find(el => (el.textContent || '').includes(title));
        row?.click();
        return { clicked: !!row, title, attempt: ${attempt} };
      })()`,
    )
    await sleep(800)
    const ready = await evalInPage(
      ws,
      `(() => {
        const pane = [...document.querySelectorAll('.chat-workspace-pane, .main-column')]
          .find(p => getComputedStyle(p).display !== 'none') || document.body;
        const text = pane.innerText || '';
        const loading = /加载中|Loading/i.test(text) && !/Summarize|总结|Thinking|思考|Review checklist|检查清单/.test(text);
        const msgs = pane.querySelectorAll('.msg, [data-msg-id]').length;
        const hasDemo = /Summarize open tasks|总结 src\\/tasks|Review checklist|检查清单|Open board|当前看板/.test(text);
        return { loading, msgs, hasDemo, textSample: text.slice(0, 120) };
      })()`,
    )
    console.log('history', ready)
    if (ready?.hasDemo || (ready?.msgs > 0 && !ready?.loading)) break
  }
  await sleep(500)

  // Metrics for cropping
  const layout = await evalInPage(
    ws,
    `(() => {
      const dpr = window.devicePixelRatio || 1;
      const full = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
      const main = document.querySelector('.main-column, .chat-workspace, .messages')?.getBoundingClientRect();
      const composer = document.querySelector('.composer-card, .composer')?.getBoundingClientRect();
      return {
        dpr,
        full,
        sidebar: sidebar && { x: sidebar.x, y: sidebar.y, width: sidebar.width, height: sidebar.height },
        main: main && { x: main.x, y: main.y, width: main.width, height: Math.min(main.height, window.innerHeight - main.y) },
        composer: composer && { x: composer.x, y: composer.y, width: composer.width, height: composer.height },
      };
    })()`,
  )
  console.log('layout', layout)

  const clipOf = (r) =>
    r
      ? {
          x: Math.max(0, Math.floor(r.x)),
          y: Math.max(0, Math.floor(r.y)),
          width: Math.max(1, Math.floor(r.width)),
          height: Math.max(1, Math.floor(r.height)),
        }
      : undefined

  // 1) Hero — full window
  await screenshot(ws, join(OUT, 'readme-hero.png'))

  // 2) Sessions — left sidebar
  if (layout.sidebar) {
    await screenshot(ws, join(FEATURE, 'sessions.png'), { clip: clipOf(layout.sidebar) })
  }

  // 3) Leader chat — main column
  if (layout.main) {
    await screenshot(ws, join(FEATURE, 'leader-chat.png'), { clip: clipOf(layout.main) })
    // Worker cards share the same chat surface when tools are present
    await screenshot(ws, join(FEATURE, 'worker-cards.png'), { clip: clipOf(layout.main) })
  }

  // 4) Approvals — open inspector if possible, else full chat with permission shield
  await evalInPage(
    ws,
    `(() => {
      const btn = [...document.querySelectorAll('button, [role=button]')]
        .find(b => /协作|Team|Inspector|面板|审批|Worker/.test(b.textContent||'') || /inspector|team/i.test(b.getAttribute('aria-label')||''));
      btn?.click();
      return btn?.textContent?.trim()?.slice(0,40) || null;
    })()`,
  )
  await sleep(500)
  await screenshot(ws, join(FEATURE, 'approvals.png'))

  // 5) Settings — models
  await evalInPage(
    ws,
    `(() => {
      window.dispatchEvent(new CustomEvent('swarmdesk-agent:open-settings', { detail: { tab: 'model' } }));
      return true;
    })()`,
  )
  await sleep(700)
  await screenshot(ws, join(FEATURE, 'settings-models.png'))

  // 6) Registry — workers tab → register / catalog surface
  await evalInPage(
    ws,
    `(() => {
      window.dispatchEvent(new CustomEvent('swarmdesk-agent:open-settings', { detail: { tab: 'workers' } }));
      return true;
    })()`,
  )
  await sleep(700)
  await evalInPage(
    ws,
    `(() => {
      // Prefer the "注册 / Register" rail action if present
      const reg = [...document.querySelectorAll('button, a, [role=tab]')]
        .find((b) => /注册|Register|添加|Add/.test(b.textContent || ''));
      reg?.click();
      return reg?.textContent?.trim()?.slice(0, 40) || null;
    })()`,
  )
  await sleep(500)
  await evalInPage(
    ws,
    `(() => {
      const input = document.querySelector(
        '.worker-registry-input, .settings-search-combobox input, input[placeholder*="Registry"], input[placeholder*="Agent"], input[placeholder*="搜索"]',
      );
      input?.focus();
      input?.click();
      return !!input;
    })()`,
  )
  await sleep(450)
  await screenshot(ws, join(FEATURE, 'registry.png'))

  // Leave settings closed for the user's session
  await evalInPage(ws, `document.querySelector('.settings-back')?.click(); true`)

  ws.close()
  console.log('\\nDone. Images under', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
