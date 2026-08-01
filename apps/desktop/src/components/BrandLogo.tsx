type BrandLogoProps = {
  className?: string
  size?: number
  /** Accessible label; omit when decorative (parent provides context). */
  title?: string
  /**
   * `app` — full plate (Dock / sidebar chip).
   * `glyph` — gold mark only, transparent background (home empty-state).
   */
  variant?: 'app' | 'glyph'
}

/**
 * SwarmDesk final brand mark (PNG).
 * Single source: `/icon.png` (app plate) or `/icon-glyph.png` (no black plate).
 */
export function BrandLogo({ className, size = 88, title, variant = 'app' }: BrandLogoProps) {
  const src = variant === 'glyph' ? '/icon-glyph.png' : '/icon.png'

  return (
    <img
      className={className ? `brand-logo ${className}` : 'brand-logo'}
      src={src}
      width={size}
      height={size}
      alt={title ?? ''}
      draggable={false}
      aria-hidden={title ? undefined : true}
    />
  )
}
