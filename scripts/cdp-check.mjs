#!/usr/bin/env node
/**
 * CDP (Chrome DevTools Protocol) checker for the running Electron app.
 * Connects to ws://127.0.0.1:9222, drives the renderer page, and reports:
 *   - console errors / warnings (since load)
 *   - DOM queries (selectors you pass)
 *   - screenshots
 *
 * Usage:
 *   node scripts/cdp-check.mjs dom <css-selector>          # print outerHTML of matches
 *   node scripts/cdp-check.mjs text <css-selector>          # print textContent of matches
 *   node scripts/cdp-check.mjs console                      # dump captured console since load
 *   node scripts/cdp-check.mjs shot <out.png>               # screenshot the page
 *   node scripts/cdp-check.mjs eval "<js-expression>"       # eval in page, print result
 *
 * No external deps — uses global WebSocket (Node 22+) or falls back to a tiny
 * ws client via dynamic import of 'ws' if present.
 *
 * Prerequisite: start the desktop with SWARMDESK_AGENT_CDP_PORT=9222.
 */
import { writeFileSync } from 'node:fs'

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1'
const CDP_PORT = process.env.CDP_PORT || '9222'

async function getPageTarget() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`)
  const list = await res.json()
  // pick the main page (type=page, title != DevTools)
  const page = list.find((t) => t.type === 'page' && t.title !== 'DevTools') ?? list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target found')
  return page
}

let WebSocketImpl
try {
  // Node 22+ has global WebSocket
  if (typeof WebSocket !== 'undefined') {
    WebSocketImpl = WebSocket
  } else {
    WebSocketImpl = (await import('ws')).WebSocket
  }
} catch (e) {
  console.error('No WebSocket available. Use Node 22+ or install ws.')
  process.exit(1)
}

let msgId = 0
const pending = new Map()

function send(ws, method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function withCdp(fn) {
  const page = await getPageTarget()
  const ws = new WebSocketImpl(page.webSocketDebuggerUrl)
  await new Promise((r, rej) => {
    ws.addEventListener ? ws.addEventListener('open', r) : ws.on('open', r)
    ws.addEventListener ? ws.addEventListener('error', rej) : ws.on('error', rej)
  })
  ws.addEventListener
    ? ws.addEventListener('message', (ev) => {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
        if (m.id && pending.has(m.id)) {
          pending.get(m.id).resolve(m)
          pending.delete(m.id)
        }
      })
    : ws.on('message', (data) => {
        const m = JSON.parse(data.toString())
        if (m.id && pending.has(m.id)) {
          pending.get(m.id).resolve(m)
          pending.delete(m.id)
        }
      })
  try {
    await send(ws, 'Runtime.enable')
    await send(ws, 'Page.enable')
    await send(ws, 'DOM.enable')
    return await fn(ws, send)
  } finally {
    ws.close()
  }
}

const cmd = process.argv[2]
const arg = process.argv[3]

async function evalInPage(ws, send, expr) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.result?.exceptionDetails) {
    return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text }
  }
  return r.result?.result?.value
}

await withCdp(async (ws, send) => {
  if (cmd === 'dom' || cmd === 'text') {
    const prop = cmd === 'dom' ? 'outerHTML' : 'textContent'
    const expr = `(() => {
      const els = document.querySelectorAll(${JSON.stringify(arg)});
      return Array.from(els).map(e => e.${prop});
    })()`
    const out = await evalInPage(ws, send, expr)
    if (out?.error) { console.error('ERR:', out.error); process.exit(1) }
    console.log(JSON.stringify(out, null, 2))
  } else if (cmd === 'eval') {
    const out = await evalInPage(ws, send, arg)
    if (out?.error) { console.error('ERR:', out.error); process.exit(1) }
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2))
  } else if (cmd === 'console') {
    // install a console message capture via Runtime, then wait briefly
    const msgs = []
    ws.addEventListener
      ? ws.addEventListener('message', (ev) => {
          const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
          if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
            msgs.push(m.params)
          }
        })
      : ws.on('message', (data) => {
          const m = JSON.parse(data.toString())
          if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
            msgs.push(m.params)
          }
        })
    // Trigger a fresh page error capture by checking existing logging via eval
    const r = await send(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const errors = (window.__capturedErrors ||= []);
        return 'page-alive:' + document.querySelectorAll('*').length + ' els';
      })()`,
      returnByValue: true,
    })
    await new Promise((r) => setTimeout(r, 500))
    console.log('--- console events captured in 500ms window ---')
    console.log(JSON.stringify(msgs, null, 2).slice(0, 3000))
  } else if (cmd === 'shot') {
    const r = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    if (r.result?.data) {
      writeFileSync(arg, Buffer.from(r.result.data, 'base64'))
      console.log('screenshot saved to', arg, `(${r.result.data.length} b64 chars)`)
    } else {
      console.error('screenshot failed', r)
    }
  } else if (cmd === 'pageinfo') {
    const out = await evalInPage(ws, send, `(() => ({
      url: location.href,
      title: document.title,
      bodyClasses: document.body.className,
      hasSidebar: !!document.querySelector('.sidebar'),
      hasComposerCard: !!document.querySelector('.composer-card'),
      hasHomeComposer: !!document.querySelector('.home-composer'),
      hasChatHead: !!document.querySelector('.chat-head'),
      hasBranchSwitcher: !!document.querySelector('.branch-switcher'),
      homeHint: document.querySelector('.home-hint')?.textContent?.trim() ?? null,
      greeting: document.querySelector('.greeting')?.textContent?.trim() ?? null,
      composerToolsCount: document.querySelectorAll('.composer-tools').length,
    }))()`)
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.error('unknown command:', cmd)
    process.exit(1)
  }
}).catch((e) => {
  console.error('CDP error:', e.message)
  process.exit(1)
})
