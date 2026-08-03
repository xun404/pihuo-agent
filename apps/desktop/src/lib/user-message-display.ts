/**
 * User messages are enriched with mode / locale / project context for the Leader.
 * UI should show only the human text; wire payload can keep the chrome.
 */

export type RouterMessageMeta = {
  mode?: string
  project?: string
  path?: string
  session?: string
  locale?: string
  model?: string
  thinking?: string
}

const LANG_PREFIX = /^(Respond in Chinese\.|Respond in English\.)\s*/i

/** Exact mode instruction prefixes injected by ChatPanel (order: longest first) */
const MODE_PREFIXES: { re: RegExp; mode: string }[] = [
  {
    mode: 'plan',
    re: /^\[mode=plan\]\s*Produce a plan only unless I ask to execute\.\s*Prefer role=plan workers if dispatching\.\s*/i,
  },
  {
    mode: 'review',
    re: /^\[mode=review\]\s*Focus on review\.\s*Prefer role=review workers\.\s*/i,
  },
  {
    mode: 'build',
    re: /^\[mode=build\]\s*Prefer role=coder then role=test\/review as needed\.\s*/i,
  },
  {
    mode: 'ask',
    re: /^\[mode=ask\]\s*/i,
  },
]

const CONTEXT_BLOCK = /\n\n\[context\][^\n]*\s*$/i
const CONTEXT_LINE = /(?:^|\n)\[context\]\s*([^\n]*)\s*$/i

function parseContextLine(line: string): RouterMessageMeta {
  const meta: RouterMessageMeta = {}
  const take = (key: keyof RouterMessageMeta, pattern: RegExp) => {
    const m = line.match(pattern)
    if (m?.[1]) meta[key] = m[1]
  }
  take('project', /\bproject=(\S+)/)
  take('path', /\bpath=(\S+)/)
  take('session', /\bsession=(\S+)/)
  take('locale', /\blocale=(\S+)/)
  take('mode', /\bmode=(\S+)/)
  take('model', /\bmodel=(\S+)/)
  take('thinking', /\bthinking=(\S+)/)
  return meta
}

/**
 * Strip router chrome and return user-visible text + optional meta chips.
 */
export function parseRouterUserMessage(raw: string): {
  text: string
  meta: RouterMessageMeta
} {
  if (!raw) return { text: '', meta: {} }

  let s = raw
  const meta: RouterMessageMeta = {}

  const ctxLine = s.match(CONTEXT_LINE)
  if (ctxLine?.[1]) {
    Object.assign(meta, parseContextLine(ctxLine[1]))
  }

  s = s.replace(LANG_PREFIX, '')

  for (const { re, mode } of MODE_PREFIXES) {
    if (re.test(s)) {
      meta.mode = meta.mode ?? mode
      s = s.replace(re, '')
      break
    }
  }

  // Fallback: bare [mode=x] without known instruction text
  const bareMode = s.match(/^\[mode=(ask|plan|build|review)\]\s*/i)
  if (bareMode) {
    meta.mode = meta.mode ?? bareMode[1]!.toLowerCase()
    s = s.replace(/^\[mode=(ask|plan|build|review)\]\s*/i, '')
  }

  s = s.replace(CONTEXT_BLOCK, '')
  s = s.replace(CONTEXT_LINE, '')

  return { text: s.trim(), meta }
}

/** Display-only helper */
export function displayUserMessageText(raw: string): string {
  return parseRouterUserMessage(raw).text
}

export type EnrichUserMessageOpts = {
  locale: string
  mode: string
  projectName?: string
  projectPath?: string
  sessionTitle?: string
  model?: string
  thinking?: string
}

/**
 * Build the wire payload text (what the Leader agent receives).
 */
export function enrichUserMessageForLeader(userText: string, opts: EnrichUserMessageOpts): string {
  const text = userText.trim()
  const langHint =
    opts.locale === 'en' || (opts.locale && opts.locale.startsWith('en'))
      ? 'Respond in English. '
      : 'Respond in Chinese. '

  const prefix =
    opts.mode === 'ask'
      ? '[mode=ask] '
      : opts.mode === 'plan'
        ? '[mode=plan] Produce a plan only unless I ask to execute. Prefer role=plan workers if dispatching. '
        : opts.mode === 'review'
          ? '[mode=review] Focus on review. Prefer role=review workers. '
          : '[mode=build] Prefer role=coder then role=test/review as needed. '

  const modelHint = opts.model ? ` model=${opts.model}` : ''
  const thinkHint = opts.thinking ? ` thinking=${opts.thinking}` : ''
  const context =
    opts.projectName && opts.projectPath
      ? `\n\n[context] project=${opts.projectName} path=${opts.projectPath} session=${opts.sessionTitle ?? ''} locale=${opts.locale} mode=${opts.mode}${modelHint}${thinkHint}`
      : `\n\n[context] locale=${opts.locale} mode=${opts.mode}${modelHint}${thinkHint}`

  return `${langHint}${prefix}${text}${context}`
}

/**
 * Enrich only the last user text part for the outbound request body.
 * Leaves non-text parts untouched.
 */
export function enrichLastUserMessageForWire<
  T extends {
    role?: string
    parts?: Array<{ type?: string; text?: string } & Record<string, unknown>>
  },
>(message: T | undefined, opts: EnrichUserMessageOpts): T | undefined {
  if (!message || message.role !== 'user' || !Array.isArray(message.parts)) return message
  const parts = message.parts.map((p) => {
    if (p.type === 'text' && typeof p.text === 'string') {
      // Avoid double-enrichment if already has chrome
      const already =
        /\[mode=(ask|plan|build|review)\]/i.test(p.text) || /\[context\]/i.test(p.text)
      const text = already ? p.text : enrichUserMessageForLeader(p.text, opts)
      return { ...p, text }
    }
    return p
  })
  return { ...message, parts }
}
