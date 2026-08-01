---
name: development-cdp
description: Use when inspecting, debugging, or automating this project's Electron development renderer through Chrome DevTools Protocol (CDP), especially for startup readiness, new-task UI flows, renderer or API state checks, React controlled inputs, multiple mounted ChatPanels, stale processes, or scripts/cdp-check.mjs commands.
---

# Development CDP

## Overview

Use the Electron renderer as the authoritative UI automation target and use
in-page API calls for stateful inspection. Verify the renderer, API, and CDP
processes independently before diagnosing application code.

The Electron development launcher enables the Chrome DevTools Protocol (CDP)
by default for local inspection and UI automation. This page documents the
**actually verified** commands and the real-world pitfalls hit while driving
a "new task → run" flow over CDP. Commands below were validated against a live
`npm run desktop` session.

## Process map

Three independent processes make up a dev session — they restart and reload
**separately**, which is the root cause of most "my change didn't apply"
confusion:

- **Vite dev server** (`5173`): renderer code, HMR on save; hook-level
  changes may still need a full window reload.
- **API server** (`4111`): `npm run dev:api` (`tsx watch`), auto-restarts on
  server-side changes. A stale process serves old routes/fields — check
  `lsof -nP -iTCP:4111 -sTCP:LISTEN` + `ps -p <pid> -o lstart` before
  debugging the renderer.
- **Electron shell** (CDP `8315`): no hot-reload. CDP refused means it was
  launched without `SWARMDESK_AGENT_CDP_PORT` — restart via
  `npm run desktop`; you cannot attach after the fact.

A Chrome/Edge tab on `localhost:5173` is _not_ the app (no
`window.routerAgents`, every call 401s). Always drive the Electron renderer.

## Start the desktop app

```bash
npm run desktop
```

CDP comes up on `http://127.0.0.1:8315` — in practice it answers within
~3 seconds of the Electron window appearing. The listener is restricted to
the loopback interface; packaged apps do not enable CDP.

Wait for **both** CDP and the API server to be ready before automating
(the API takes a couple more seconds and is what the chat transport needs):

```bash
curl -s http://127.0.0.1:8315/json/version    # browser version + webSocketDebuggerUrl
curl -s http://127.0.0.1:4111/health          # API health (empty 200 = ok)
curl -s http://127.0.0.1:8315/json/list       # all targets (pick the type=page one)
```

## Override or disable the port

```bash
SWARMDESK_AGENT_CDP_PORT=8415 npm run desktop      # change the listener port
CDP_PORT=8415 node scripts/cdp-check.mjs pageinfo  # checker honors CDP_PORT
```

Setting `SWARMDESK_AGENT_CDP_PORT=` (empty) disables the dev default. Never
bind CDP to a non-loopback address: it has no application-level auth and can
drive the renderer.

## Inspect the renderer

```bash
node scripts/cdp-check.mjs pageinfo          # what region is mounted, locale, etc.
node scripts/cdp-check.mjs console           # 500ms window of console/exception events
node scripts/cdp-check.mjs dom '.sidebar'    # outerHTML of matches
node scripts/cdp-check.mjs text '.chat-head' # textContent of matches
node scripts/cdp-check.mjs eval "<js>"       # eval in page, print result (await ok)
node scripts/cdp-check.mjs shot /tmp/x.png   # screenshot
```

`pageinfo` is the right first call every session — it confirms the renderer
booted, which shell regions exist, and which locale is active.

## curl the API directly (no CDP needed)

For pure backend checks, skip CDP: the desktop bearer token lives in
`~/.config/swarmdesk-agent/data/runtime.json`. Send it as **both** headers:

```bash
TOK=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.config/swarmdesk-agent/data/runtime.json','utf8')).desktopToken)")
curl -s http://127.0.0.1:4111/api/snapshot \
  -H "Authorization: Bearer $TOK" -H "X-SwarmDesk-Agent-Desktop-Token: $TOK"
```

`/health` is the only unauthenticated endpoint. Note some POSTs have side
effects (`/read` stamps the lamp watermark, `activate` bumps `updatedAt`) —
prefer GETs when just inspecting.

---

## Driving a "new task → run" flow over CDP

Two modes are useful, and they fail differently. **Reach for in-page `fetch`
from `eval` for anything stateful; reserve DOM clicks for things you can
visually verify.**

### Mode A — DOM clicks (UI automation)

Useful for reproducing the actual user gesture. Drives the same code path
the user does, including the new-task auto-send behavior.

Click a sidebar button by **visible text**, never by `:nth-child`:

```bash
node scripts/cdp-check.mjs eval " \
  [...document.querySelectorAll('.sidebar .nav-item')] \
    .find(b => /新建任务|New task/.test(b.textContent))?.click() ?? 'not found'"
```

Typing into the composer — React's controlled `<textarea>` ignores a raw
`.value =` assignment (the send button stays disabled). You must use the
native setter and dispatch `input`:

```bash
node scripts/cdp-check.mjs eval "(() => { \
  const ta = document.querySelector('.home-composer textarea.composer-input'); \
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; \
  set.call(ta, '请用一句话回答：你是谁？'); \
  ta.dispatchEvent(new Event('input', { bubbles: true })); \
  return { value: ta.value, sendDisabled: document.querySelector('.home-composer button.send')?.disabled }; })()"
# expect sendDisabled: false
```

Submit:

```bash
node scripts/cdp-check.mjs eval "document.querySelector('.home-composer button.send')?.click()"
```

After submit, the app creates a session on the server and **auto-sends the
text** as the session's first message — the leader starts replying within a
second or two. Poll the visible pane for the result (see below).

### Mode B — in-page `fetch` (reliable for state inspection)

The renderer already holds the desktop bearer token and API base URL on
`window.routerAgents`. Calling `fetch` from `eval` skips every UI timing
issue and is the recommended way to read authoritative state:

```bash
# Snapshot — authoritative session list, including which one is really active
node scripts/cdp-check.mjs eval "(async () => { \
  const tok = await window.routerAgents?.getDesktopToken?.(); \
  const base = window.routerAgents?.apiBase || 'http://127.0.0.1:4111'; \
  const r = await fetch(base + '/api/snapshot', { \
    headers: { Authorization: 'Bearer ' + tok, 'X-SwarmDesk-Agent-Desktop-Token': tok } }); \
  const j = await r.json(); \
  return { activeSessionId: j.activeSessionId, activeProjectId: j.activeProjectId, \
           sessions: (j.sessions||[]).map(s => ({ id: s.id, title: s.title, status: s.status })) }; \
})()"
```

This is how you confirm — independent of the DOM — which session received
the next message, and which sessions are `running` / `idle` / `error`.

### Reading the visible pane reliably

There can be multiple mounted ChatPanels (keep-alive for parallel sessions).
**Always scope queries to the visible pane** — querying `document.querySelector`
directly can hit a hidden pane and give stale data:

```bash
node scripts/cdp-check.mjs eval "(() => { \
  const pane = [...document.querySelectorAll('.chat-workspace-pane')] \
    .find(p => getComputedStyle(p).display !== 'none'); \
  return { \
    title: pane?.querySelector('.chat-head .title')?.textContent?.trim() ?? null, \
    composerValue: pane?.querySelector('textarea.composer-input')?.value ?? null, \
    msgCount: pane?.querySelectorAll('.messages .msg').length ?? 0, \
    hasStopBtn: !!pane?.querySelector('button.send.stop'), \
    lastUserBubble: pane?.querySelector('.msg.user .bubble')?.textContent?.trim() ?? null, \
    lastLeaderText: pane?.querySelector('.msg.leader:last-of-type .sup-body')?.textContent?.trim() ?? null, \
  }; })()"
```

### Sidebar status dots (read-only signals)

Per-row classes on `.sess`, derived by `sessionLampClass` (shared package)
from event timestamps + the `lastReadAt` watermark, priority high → low:
`.sess.approve` (needs authorization) → `.sess.run` (executing, pulsing
green) → `.sess.error` (unread error; out 3s after read) → `.sess.done`
(unread completion, steady green; out on read) → `.sess.idle`. Notification
lamps (error/done) also auto-expire 60s after the event while the session is
active. Driving fields: `status`, `lastErrorAt`, `lastReplyAt` /
`lastFinishedAt`, `lastReadAt`; verify via the Mode B snapshot eval, not the
DOM (frontend refreshes on an 8s poll — wait a cycle before asserting).

`.sess.active` is the sidebar's highlighted row; it agrees with the main
panel (the backend `activeSessionId` is the single source of truth and the
sidebar derives highlight from it).

## Real pitfalls observed while doing this

1. **Wait for the API, not just CDP.** The API child process takes a couple
   extra seconds to bind `:4111` after CDP is up. Polling `/health` first
   avoids a `home-composer` that is disabled with `serverUp: false` and a
   silent "message never sent."

2. **Pick elements by visible text, not position.** `:nth-child` selectors
   break the moment the sidebar reorders. `/新建任务|New task/` is stable
   across locales.

3. **React controlled inputs need the native setter + `input` event.** A raw
   `.value =` does not fire `onChange`, so React's state stays stale and the
   send button stays disabled. See the recipe above.

4. **Fire `input` events when writing into React inputs.** Setting `.value`
   directly is ignored by React's controlled components.

5. **Scope DOM reads to the visible pane.** Multiple ChatPanels can be
   mounted for parallel sessions; `document.querySelector('.chat-head')` may
   hit a hidden one. Use the `getComputedStyle(...).display !== 'none'`
   filter shown above.

6. **Don't use `msgCount` deltas as the "sent" signal.** On first send in a
   thread the renderer hydrates the whole history at once — `messages.length`
   can jump from 0 to N in one tick. The reliable signal for a successful
   send is the user bubble appearing with the text you typed, plus the send
   button morphing to Stop.

7. **`button.send.stop` / streaming windows can be short.** With a fast model
   the turn may finish in ~1–2s; polling once per second you may simply
   never observe the streaming state. Disambiguate via the leader text content.

8. **The dev build auto-opens a detached DevTools window.** It can steal
   focus during automation; close it, CDP on `:8315` is unaffected.

9. **Backend health ≠ turn progress.** The `● 运行中 / ● Running` badge in
   `chat-head` only reports API reachability. Turn progress is the send
   button morphing to Stop and the sidebar `.sess.run` class.

10. **`eval` accepts `await`.** `cdp-check.mjs` sets `awaitPromise: true`, so
    `eval "(async () => { … })()"` works for any in-page fetch.

11. **"Change didn't apply" is usually process state, not code.** Stale API
    process (old routes/fields), stale Electron shell (no CDP), or persisted
    session state (e.g. `status: running` outliving the run — reconciled at
    API boot). Check the process map and the snapshot before touching code.
