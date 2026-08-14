#!/usr/bin/env node
/**
 * Logo fallback smoke: unit-style degradation sims + live API + optional CDP UI check.
 *
 * Usage:
 *   node scripts/cdp-logo-fallback-smoke.mjs
 *   node scripts/cdp-logo-fallback-smoke.mjs --provider openrouter
 *   node scripts/cdp-logo-fallback-smoke.mjs --skip-cdp
 *
 * Requires: desktop API on :4111 (and CDP :8315 unless --skip-cdp).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkerPath = join(root, 'scripts/cdp-check.mjs')

function parseArgs(argv) {
  const out = { provider: 'openrouter', skipCdp: false }
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--provider') out.provider = argv[++i] ?? out.provider
    else if (argv[i] === '--skip-cdp') out.skipCdp = true
    else if (argv[i] === '--help') {
      console.log(`Usage: node scripts/cdp-logo-fallback-smoke.mjs [--provider id] [--skip-cdp]`)
      process.exit(0)
    }
  }
  return out
}

async function cdpEval(expr) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [checkerPath, 'eval', expr],
    { cwd: root, maxBuffer: 4 * 1024 * 1024, env: process.env },
  )
  if (stderr?.trim()) console.error(stderr.trim())
  const text = stdout.trim()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function loadCatalogModule() {
  // Prefer built or ts via dynamic import path used by tests
  return import(join(root, 'packages/core/src/models-dev-catalog.ts'))
}

function desktopToken() {
  const runtimePath = join(
    process.env.HOME || '',
    '.config/pihuo-agent/data/runtime.json',
  )
  if (!existsSync(runtimePath)) return null
  try {
    return JSON.parse(readFileSync(runtimePath, 'utf8')).desktopToken ?? null
  } catch {
    return null
  }
}

async function runSimulatedFallbacks(mod, providerId) {
  const {
    ensureProviderLogoCached,
    modelsDevCatalogPaths,
    modelsDevLogoCandidateUrls,
  } = mod
  const rootDir = mkdtempSync(join(tmpdir(), 'sd-logo-cdp-'))
  const paths = modelsDevCatalogPaths(rootDir, join(rootDir, 'cache'))
  const urls = modelsDevLogoCandidateUrls(providerId)
  const svg = (label) =>
    `<svg xmlns="http://www.w3.org/2000/svg" data-src="${label}"><rect width="10" height="10"/></svg>`

  const scenarios = [
    {
      name: 'models.dev succeeds (no fallback)',
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('models.dev/logos')) {
          return new Response(svg('models.dev'), { status: 200 })
        }
        throw new Error(`unexpected url ${url}`)
      },
      expectSource: /models\.dev\/logos/,
    },
    {
      name: 'models.dev ECONNRESET → GitHub raw',
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('models.dev/logos')) {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
          })
        }
        if (url.includes('raw.githubusercontent.com')) {
          return new Response(svg('github'), { status: 200 })
        }
        return new Response('no', { status: 404 })
      },
      expectSource: /raw\.githubusercontent\.com/,
    },
    {
      name: 'models.dev + GitHub fail → jsDelivr',
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('models.dev/logos') || url.includes('raw.githubusercontent.com')) {
          return new Response('nope', { status: 502 })
        }
        if (url.includes('cdn.jsdelivr.net')) {
          return new Response(svg('jsdelivr'), { status: 200 })
        }
        return new Response('no', { status: 404 })
      },
      expectSource: /cdn\.jsdelivr\.net/,
    },
    {
      name: 'all candidates fail → null (UI fallback)',
      fetchImpl: async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
        })
      },
      expectSource: null,
      expectNull: true,
    },
  ]

  const results = []
  for (const sc of scenarios) {
    // isolate cache per scenario
    const scRoot = mkdtempSync(join(tmpdir(), 'sd-logo-sc-'))
    const scPaths = modelsDevCatalogPaths(scRoot, join(scRoot, 'cache'))
    try {
      const out = await ensureProviderLogoCached({
        providerId,
        paths: scPaths,
        timeoutMs: 9_000,
        fetchImpl: sc.fetchImpl,
      })
      const ok = sc.expectNull
        ? out.svg == null && !out.fromCache
        : Boolean(out.svg?.includes('<svg')) &&
          sc.expectSource.test(out.sourceUrl ?? '')
      results.push({
        scenario: sc.name,
        ok,
        fromCache: out.fromCache,
        sourceUrl: out.sourceUrl ?? null,
        hasSvg: Boolean(out.svg),
      })
    } catch (e) {
      results.push({
        scenario: sc.name,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      try {
        rmSync(scRoot, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }

  try {
    rmSync(rootDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }

  return { candidates: urls, results }
}

async function runLiveInstrumented(mod, providerId) {
  const {
    ensureProviderLogoCached,
    modelsDevCatalogPaths,
    modelsDevLogoCandidateUrls,
  } = mod
  const rootDir = mkdtempSync(join(tmpdir(), 'sd-logo-live-'))
  const paths = modelsDevCatalogPaths(rootDir, join(rootDir, 'cache'))
  const tried = []
  const realFetch = globalThis.fetch
  const out = await ensureProviderLogoCached({
    providerId,
    paths,
    timeoutMs: 45_000,
    fetchImpl: async (input, init) => {
      const url = String(input)
      tried.push(url)
      try {
        const res = await realFetch(input, init)
        tried[tried.length - 1] = `${url} → ${res.status}`
        return res
      } catch (e) {
        const code = e?.cause?.code || e?.code || e?.message
        tried[tried.length - 1] = `${url} → ERR ${code}`
        throw e
      }
    },
  })
  const result = {
    candidates: modelsDevLogoCandidateUrls(providerId),
    tried,
    ok: Boolean(out.svg),
    fromCache: out.fromCache,
    sourceUrl: out.sourceUrl ?? null,
    svgBytes: out.svg ? Buffer.byteLength(out.svg, 'utf8') : 0,
  }
  try {
    rmSync(rootDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  return result
}

async function runApiLive(providerId) {
  const tok = desktopToken()
  if (!tok) return { ok: false, error: 'no desktop token' }
  const cachePath = join(
    process.env.HOME || '',
    '.config/pihuo-agent/cache/provider-logos',
    `${providerId.replace(/[^a-zA-Z0-9._-]/g, '_')}.svg`,
  )
  // force re-fetch path through API by removing cache entry
  try {
    if (existsSync(cachePath)) rmSync(cachePath)
  } catch {
    /* ignore */
  }
  const res = await fetch(`http://127.0.0.1:4111/api/provider-logos/${encodeURIComponent(providerId)}`, {
    headers: {
      Authorization: `Bearer ${tok}`,
      'X-PiHuo-Agent-Desktop-Token': tok,
    },
  })
  const text = await res.text()
  return {
    ok: res.ok && text.includes('<svg'),
    status: res.status,
    bytes: text.length,
    preview: text.slice(0, 80).replace(/\s+/g, ' '),
    note: 'API uses server process fetch (restart desktop if logo code is stale)',
  }
}

async function runCdpUi(providerId) {
  // Open settings model tab and models-dev import if possible; probe logo API from renderer
  const prep = await cdpEval(`(async () => {
    window.dispatchEvent(new CustomEvent('pihuo-agent:open-settings', { detail: { tab: 'model' } }));
    await new Promise(r => setTimeout(r, 600));
    const tok = await window.routerAgents?.getDesktopToken?.();
    const base = window.routerAgents?.apiBase || 'http://127.0.0.1:4111';
    const h = { Authorization: 'Bearer ' + tok, 'X-PiHuo-Agent-Desktop-Token': tok };
    const logoRes = await fetch(base + '/api/provider-logos/${providerId}', { headers: h });
    const logoText = await logoRes.text();
    // list providers (may be empty fixture)
    let providers = [];
    try {
      const pr = await fetch(base + '/api/models-dev/providers', { headers: h });
      const pj = await pr.json();
      providers = (pj.providers || []).slice(0, 5).map(p => p.id);
    } catch {}
    // click add-from-models-dev if present
    const addBtn = [...document.querySelectorAll('button')].find(b =>
      /从 models\\.dev|Add from models\\.dev|models\\.dev/.test(b.textContent || '')
    );
    if (addBtn) {
      addBtn.click();
      await new Promise(r => setTimeout(r, 800));
    }
    const logoEls = [...document.querySelectorAll('[aria-label], [title], span[role="img"]')]
      .filter(el => {
        const t = (el.getAttribute('aria-label') || el.getAttribute('title') || '') + (el.textContent || '');
        return providers.some(id => t.includes(id)) || /openrouter|openai|anthropic/i.test(t);
      })
      .slice(0, 8)
      .map(el => ({
        label: el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.slice(0, 40),
        hasSvg: !!el.querySelector('svg') || /<svg/i.test(el.innerHTML || ''),
      }));
    return {
      settingsOpen: !!document.querySelector('.settings-panel, .settings-layer, [class*=settings]'),
      logoHttp: logoRes.status,
      logoOk: logoRes.ok && logoText.includes('<svg'),
      logoBytes: logoText.length,
      providersSample: providers,
      logoEls,
    };
  })()`)

  return prep
}

async function main() {
  const args = parseArgs(process.argv)
  const providerId = args.provider
  console.log(JSON.stringify({ phase: 'start', providerId }, null, 2))

  const mod = await loadCatalogModule()
  const simulated = await runSimulatedFallbacks(mod, providerId)
  const liveInstr = await runLiveInstrumented(mod, providerId)
  const apiLive = await runApiLive(providerId)

  let cdp = null
  if (!args.skipCdp) {
    try {
      cdp = await runCdpUi(providerId)
    } catch (e) {
      cdp = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  const simPass = simulated.results.every((r) => r.ok)
  const report = {
    simulated: { pass: simPass, ...simulated },
    liveInstrumented: liveInstr,
    apiLive,
    cdp,
    summary: {
      simulatedPass: simPass,
      liveGotSvg: liveInstr.ok,
      liveSource: liveInstr.sourceUrl,
      apiLiveOk: apiLive.ok,
      cdpLogoOk: cdp?.logoOk ?? null,
    },
  }
  console.log(JSON.stringify(report, null, 2))
  if (!simPass) process.exitCode = 1
  if (!liveInstr.ok && !apiLive.ok) {
    console.error(
      'WARN: live logo fetch failed (network). Simulated fallbacks still exercised.',
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
