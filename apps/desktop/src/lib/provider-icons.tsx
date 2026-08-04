/**
 * Provider logos: always from models.dev (via API logo cache).
 * Monochrome currentColor glyphs + neutral fallback. No per-brand colors.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { api } from './api'

/** providerId → successful SVG text only (failures are not cached permanently). */
const remoteLogoCache = new Map<string, string>()
const remoteLogoInflight = new Map<string, Promise<string | null>>()

async function loadRemoteLogo(providerId: string): Promise<string | null> {
  const hit = remoteLogoCache.get(providerId)
  if (hit) return hit
  const pending = remoteLogoInflight.get(providerId)
  if (pending) return pending
  const job = api
    .providerLogo(providerId)
    .then((svg) => {
      const ok = typeof svg === 'string' && (svg.includes('<svg') || svg.includes('<SVG'))
      if (ok && svg) {
        remoteLogoCache.set(providerId, svg)
        return svg
      }
      return null
    })
    .catch(() => null)
    .finally(() => {
      remoteLogoInflight.delete(providerId)
    })
  remoteLogoInflight.set(providerId, job)
  return job
}

function InlineRemoteSvg({ svg, size, title }: { svg: string; size: number; title: string }) {
  const html = svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    const cleaned = String(attrs)
      .replace(/\s(width|height)="[^"]*"/gi, '')
      .replace(/\s(width|height)='[^']*'/gi, '')
    return `<svg width="${size}" height="${size}" role="img" aria-label="${title}"${cleaned}>`
  })
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      style={{
        display: 'inline-flex',
        width: size,
        height: size,
        lineHeight: 0,
        flexShrink: 0,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function SvgFrame({
  size,
  children,
  title,
  style,
}: {
  size: number
  children: ReactNode
  title: string
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <title>{title}</title>
      {children}
    </svg>
  )
}

/** Fallback when models.dev logo is unavailable */
function FallbackLogo({ id, size }: { id: string; size: number }) {
  const label =
    id
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 2)
      .toUpperCase() || '?'
  return (
    <SvgFrame size={size} title={id}>
      <rect width="24" height="24" rx="6" fill="currentColor" opacity="0.15" />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="10"
        fontWeight="700"
        fill="currentColor"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </SvgFrame>
  )
}

export function ProviderLogo({
  providerId,
  size = 18,
  className,
}: {
  providerId: string
  size?: number
  className?: string
}) {
  const [remoteSvg, setRemoteSvg] = useState<string | null | undefined>(() =>
    remoteLogoCache.get(providerId),
  )

  useEffect(() => {
    const cached = remoteLogoCache.get(providerId)
    if (cached) {
      setRemoteSvg(cached)
      return
    }
    let cancelled = false
    setRemoteSvg(undefined)
    void loadRemoteLogo(providerId).then((svg) => {
      if (!cancelled) setRemoteSvg(svg)
    })
    return () => {
      cancelled = true
    }
  }, [providerId])

  const mark: ReactNode = remoteSvg ? (
    <InlineRemoteSvg svg={remoteSvg} size={size} title={providerId} />
  ) : (
    <FallbackLogo id={providerId} size={size} />
  )

  return (
    <span
      className={className}
      style={{
        color: 'var(--text-1)',
        lineHeight: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {mark}
    </span>
  )
}
