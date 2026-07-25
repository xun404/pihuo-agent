/** Linear UI icons (stroke 1.75, round cap). Brand small-mark uses 🐝. */
import React, { useEffect, useState } from 'react'
import { api } from '../lib/api'

type IconProps = {
  className?: string
  size?: number
  title?: string
}

function baseProps({ className, size = 16, title }: IconProps) {
  return {
    className: className ? `i ${className}` : 'i',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': title ? undefined : true,
    role: title ? ('img' as const) : undefined,
    'aria-label': title,
  }
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconFolder(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
    </svg>
  )
}

/** External-link / open project (wireframe i-open) */
export function IconOpen(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

export function IconCpu(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 9h6v6H9z" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  )
}

export function IconWorkers(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <circle cx="6" cy="8" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="M8 9.5 11 15M16 9.5 13 15M8.5 8h7" />
    </svg>
  )
}

/** Crew / team template grouping mark */
export function IconCrew(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="16.5" cy="9" r="2" />
      <path d="M4.2 17.5c.4-2.3 2.4-4 4.8-4s4.4 1.7 4.8 4" />
      <path d="M14 17.5c.3-1.6 1.6-2.9 3.4-3 1.7.1 3 1.3 3.4 3" />
    </svg>
  )
}

/**
 * Leader / sidebar brand glyph.
 * Full honeycomb mark lives in docs/assets/icon.svg; small UI marks use 🐝.
 */
export function IconQueenBee({ className, size = 16, title }: IconProps) {
  return (
    <span
      className={className ? `i queen-bee ${className}` : 'i queen-bee'}
      style={{
        width: size,
        height: size,
        fontSize: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      🐝
    </span>
  )
}

/** Alias for Leader / supervisor call sites. */
export function IconSupervisor(p: IconProps) {
  return <IconQueenBee {...p} size={p.size ?? 14} />
}

export function IconInfo(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 8h.01" />
    </svg>
  )
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  )
}

export function IconChevronDown(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 12 })}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function IconChevronLeft(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function IconArrowUp(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

export function IconPanel(p: IconProps) {
  return (
    <svg {...baseProps(p)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  )
}

export function IconProject(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 15 })}>
      <path d="M4 8h16M4 12h16M4 16h10" />
    </svg>
  )
}

export function IconShield(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 13 })}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
    </svg>
  )
}

/** Auto-edit (wireframe i-edit) */
export function IconEdit(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

/** Plan mode — list/checklist (distinct from edit pencil) */
export function IconPlan(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M9 6h12M9 12h12M9 18h8" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  )
}

/** Access mode icons for Composer 访问模式 menu (wireframe §5.3) */
export function AccessModeIcon({
  id,
  size = 14,
  className,
}: {
  id: 'confirm' | 'auto_edit' | 'plan' | 'full_access'
  size?: number
  className?: string
}) {
  switch (id) {
    case 'confirm':
      return <IconShield size={size} className={className} />
    case 'auto_edit':
      return <IconEdit size={size} className={className} />
    case 'plan':
      return <IconPlan size={size} className={className} />
    case 'full_access':
      return <IconShield size={size} className={className} />
  }
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}

export function IconSpark(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 22 })}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
    </svg>
  )
}

/** Home empty logo-cloud (wireframe i-terminal)；末横线可做光标闪烁 */
export function IconTerminal(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 40 })}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m7 10 3 2-3 2" />
      <path className="logo-cursor" d="M12 14h5" />
    </svg>
  )
}

export function IconBranch(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 13 })}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M6 8.5v3a3 3 0 0 0 3 3h3M18 8.5v1.5a3 3 0 0 1-3 3h-1" />
    </svg>
  )
}

/** Context usage ring: 20×20, no center icon. pct 0–100. */
export function ContextRing({
  pct,
  className,
  title,
}: {
  pct: number
  className?: string
  title?: string
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  const c = 2 * Math.PI * 8
  const dash = (clamped / 100) * c
  const high = clamped > 80
  const crit = clamped > 95
  return (
    <span
      className={`ctx-meter${high ? ' high' : ''}${crit ? ' crit' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      role="img"
      aria-label={title}
    >
      <svg className="ring" viewBox="0 0 20 20" width={20} height={20} aria-hidden>
        <circle className="ring-bg" cx="10" cy="10" r="8" />
        <circle
          className="ring-fg"
          cx="10"
          cy="10"
          r="8"
          style={{
            strokeDasharray: `${dash} ${c}`,
          }}
        />
      </svg>
    </span>
  )
}

/** Brand marks for AgentWorker (wireframe i-claude / i-codex / i-opencode). */
export function IconClaude(p: IconProps) {
  const { className, size = 14, title } = p
  return (
    <svg
      className={className ? `i i-fill ${className}` : 'i i-fill'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  )
}

export function IconCodex(p: IconProps) {
  const { className, size = 14, title } = p
  return (
    <svg
      className={className ? `i i-fill ${className}` : 'i i-fill'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  )
}

export function IconOpenCode(p: IconProps) {
  const { className, size = 14, title } = p
  return (
    <svg
      className={className ? `i i-fill ${className}` : 'i i-fill'}
      width={size}
      height={Math.round((size * 30) / 24)}
      viewBox="0 0 24 30"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      <path fillOpacity="0.38" d="M18 24H6V12H18V24Z" />
      <path d="M18 6H6V24H18V6ZM24 30H0V0H24V30Z" />
    </svg>
  )
}

/**
 * Worker brand icons source of truth:
 * - brand key from WorkerRegistration.kind (claude|codex|opencode|custom)
 * - fallback: infer from display name (e.g. "Claude Code")
 * - SVG marks: IconClaude / IconCodex / IconOpenCode / abstract custom
 * - colored chip: wrap with class `worker-logo ${brand}` (see 04-chat.css tokens)
 */
export function resolveWorkerBrand(
  kind?: string | null,
  name?: string | null,
): 'claude' | 'codex' | 'opencode' | 'custom' {
  const k = (kind ?? '').toLowerCase()
  if (k === 'claude' || k.includes('claude')) return 'claude'
  if (k === 'codex' || k.includes('codex')) return 'codex'
  if (k === 'opencode' || k.includes('opencode')) return 'opencode'
  if (k === 'gemini' || k.includes('gemini')) return 'custom'
  const n = (name ?? '').toLowerCase()
  if (n.includes('claude')) return 'claude'
  if (n.includes('codex') || n.includes('openai')) return 'codex'
  if (n.includes('opencode')) return 'opencode'
  return 'custom'
}

/** CSS class suffix for `.worker-logo.{brand}` color chips. */
export function workerBrandClass(kind?: string | null, name?: string | null): string {
  return resolveWorkerBrand(kind, name)
}

// Module-level cache of fetched registry icons: workerId → sanitized SVG text.
// Icons rarely change, so caching avoids re-fetching on every render.
const iconCache = new Map<string, string>()

function sanitizeIconSvg(svg: string): string | null {
  // Reject anything that is not an <svg…> document, and strip script/event
  // handlers so a compromised icon cannot run code. The icon source is a
  // trusted CDN, but defense-in-depth is cheap here.
  if (!/<svg[\s>]/i.test(svg)) return null
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
}

// Generic cached-icon hook: fetch SVG text once per key, sanitize, and cache.
// `iconCache` is shared across worker/registry icons by namespacing the key.
function useCachedIcon(
  key: string | undefined,
  fetcher: (signal?: AbortSignal) => Promise<string | null>,
): string | null {
  const [svg, setSvg] = useState<string | null>(() =>
    key ? (iconCache.get(key) ?? null) : null,
  )
  useEffect(() => {
    if (!key) {
      setSvg(null)
      return
    }
    const cached = iconCache.get(key)
    if (cached !== undefined) {
      setSvg(cached)
      return
    }
    let cancelled = false
    fetcher()
      .then((raw) => {
        if (cancelled) return
        const clean = raw ? sanitizeIconSvg(raw) : null
        iconCache.set(key, clean ?? '')
        setSvg(clean)
      })
      .catch(() => {
        if (cancelled) return
        iconCache.set(key, '')
        setSvg(null)
      })
    return () => {
      cancelled = true
    }
    // fetcher is stable per-key (module-level api methods); depend on key only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return svg
}

/** Fetch a registered worker's locally-cached icon by workerId. */
export function useWorkerIcon(workerId?: string): string | null {
  return useCachedIcon(workerId ? `worker:${workerId}` : undefined, (signal) =>
    api.workerIcon(workerId!, signal),
  )
}

/** Fetch a registry agent's icon by agentId (via the self-hosted proxy). */
export function useRegistryAgentIcon(agentId?: string): string | null {
  return useCachedIcon(agentId ? `agent:${agentId}` : undefined, (signal) =>
    api.registryAgentIcon(agentId!, signal),
  )
}

/** Render an inline registry icon by agentId, or null when there is none. */
export function RegistryAgentIcon({ agentId, size }: { agentId?: string; size?: number }) {
  const svg = useRegistryAgentIcon(agentId)
  if (!svg) return null
  return (
    <span
      className="registry-agent-icon-inline"
      style={size ? { width: size, height: size } : undefined}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-hidden
    />
  )
}

export function WorkerBrandLogo({
  kind,
  name,
  size = 14,
  workerId,
  hasIcon,
  iconAgentId,
}: {
  kind?: string
  name?: string
  size?: number
  /** When set, fetch the registry icon and render it inline. */
  workerId?: string
  /** Hint that an icon may exist (worker.iconPath truthy). Avoids a 404 fetch when false. */
  hasIcon?: boolean
  /** Registry agent id to resolve an icon when no prepared worker icon exists. */
  iconAgentId?: string
}) {
  // Prefer the worker's own prepared icon; fall back to a registry-agent icon
  // matched at registration time (e.g. custom-added CLI).
  const shouldFetch = Boolean(workerId && hasIcon)
  const workerSvg = useWorkerIcon(shouldFetch ? workerId : undefined)
  const registrySvg = useRegistryAgentIcon(!workerSvg ? iconAgentId : undefined)
  const svg = workerSvg ?? registrySvg
  if (svg) {
    return (
      <span
        className="worker-brand-icon"
        style={{ width: size, height: size, display: 'inline-flex' }}
        // Icon SVG comes from the trusted registry CDN and is sanitized above.
        dangerouslySetInnerHTML={{ __html: svg }}
        aria-hidden
      />
    )
  }
  const brand = resolveWorkerBrand(kind, name)
  if (brand === 'claude') return <IconClaude size={size} />
  if (brand === 'codex') return <IconCodex size={size} />
  if (brand === 'opencode') return <IconOpenCode size={size} />
  // custom: abstract agent mark (not a “+ in circle” that looks like a bug)
  return (
    <svg
      className="i i-fill"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="8" cy="9" r="2.2" />
      <circle cx="16" cy="9" r="2.2" />
      <circle cx="12" cy="16" r="2.2" />
      <path
        d="M9.6 10.4 11.2 14.2M14.4 10.4 12.8 14.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ============================================================
// 节点专属图标
// 每种工具/节点类型有独立图标，替代通用扳手。
// 图标始终静态——不 spin / 不旋转。
// ============================================================

/** read / view / file_read / cat — 文件阅读 */
export function IconFileText(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  )
}

/** edit / str_replace / multiedit / apply_patch — 铅笔编辑 */
export function IconPencil(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}

/** write / create / file_write — 文件创建/写入 */
export function IconFileEdit(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  )
}

/** grep / glob / search / find / ripgrep — 搜索 */
export function IconSearch(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

/** task / sub-agent — AI agent 节点 */
export function IconAIAgent(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <rect x="4" y="7" width="16" height="13" rx="2" />
      <circle cx="9" cy="13" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.3" fill="currentColor" stroke="none" />
      <path d="M12 3v4M9 3h6" />
    </svg>
  )
}

/** 通用工具 fallback（扳手）*/
export function IconWrench(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2 2.5-2.5z" />
    </svg>
  )
}

/** fetch / web / http — globe icon (对齐线稿 i-globe) */
export function IconGlobe(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

/** bash / shell / cmd / terminal-box */
export function IconTerminalBox(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 3 3-3 3" />
      <path d="M13 15h5" />
    </svg>
  )
}

/** bolt — Supervisor model badge / thinking-intensity meta（对齐线稿 i-bolt）*/
export function IconBolt(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })} viewBox="0 0 16 16">
      <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** clock — Supervisor footer duration meta（对齐线稿 i-clock）*/
export function IconClock(p: IconProps) {
  return (
    <svg
      {...baseProps({ ...p, size: p.size ?? 14 })}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.2 1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** trash — delete/remove tools (AcpToolKind 'delete') */
export function IconTrash(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" />
    </svg>
  )
}

/** move — move/rename tools (AcpToolKind 'move') */
export function IconMove(p: IconProps) {
  return (
    <svg {...baseProps({ ...p, size: p.size ?? 14 })}>
      <path d="M5 9l-3 3 3 3M19 15l3-3-3-3M9 5l3-3 3 3M15 19l-3 3-3-3M2 12h20M12 2v20" />
    </svg>
  )
}

type IconComponent = React.FC<IconProps>

/**
 * 工具名 → 专属图标映射。
 * 用 includes 语义（非 ^ 锚定）—— 实际工具名既有 lowercase CLI 工具
 * （bash/read/edit…），也有 PascalCase + Tool 后缀的 router 自有工具
 * （dispatchWorkerTool / getActiveContextTool / listWorkersTool）。
 * 匹配顺序：先 router 自有工具（更具体），再外部 CLI 工具，最后 fallback。
 * 返回的图标始终静态（不 spin）。
 */
export function getToolIcon(toolName: string): IconComponent {
  const name = toolName.toLowerCase().trim()
  // router session tools（PascalCase → lowercase 后用 includes 匹配）
  if (name.includes('dispatch') && name.includes('worker')) return IconAIAgent
  if (name.includes('list') && name.includes('worker')) return IconWorkers
  if (name.includes('context')) return IconInfo
  if (name.includes('list') && name.includes('project')) return IconFolder
  if (name.includes('job')) return IconClock
  // 外部 CLI 工具（lowercase，对齐 AcpToolKind）
  if (name.includes('delete') || name.includes('remove') || name.includes('rm')) return IconTrash
  if (name.includes('move') || name.includes('rename')) return IconMove
  if (name.includes('edit') || name.includes('str_replace') || name.includes('patch'))
    return IconPencil
  if (name.includes('write') || name.includes('create')) return IconFileEdit
  if (name.includes('read') || name.includes('view') || name.includes('cat')) return IconFileText
  if (
    name.includes('bash') ||
    name.includes('shell') ||
    name.includes('terminal') ||
    name.includes('exec')
  )
    return IconTerminalBox
  if (
    name.includes('grep') ||
    name.includes('glob') ||
    name.includes('search') ||
    name.includes('find')
  )
    return IconSearch
  if (name.includes('task') || name.includes('agent')) return IconAIAgent
  if (
    name.includes('fetch') ||
    name.includes('web') ||
    name.includes('curl') ||
    name.includes('http')
  )
    return IconGlobe
  if (name.startsWith('git')) return IconBranch
  return IconWrench
}
