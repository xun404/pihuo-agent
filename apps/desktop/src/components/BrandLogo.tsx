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
 * Public asset URL relative to Vite `base` (must stay relative for packaged
 * Electron `file://` loads — absolute `/icon.png` resolves to the OS root).
 */
function brandIconUrl(file: 'icon.png' | 'icon-glyph.png'): string {
  const base = import.meta.env.BASE_URL || './'
  // BASE_URL is always slash-terminated (`/` or `./`); avoid double slashes.
  return `${base}${file}`
}

/**
 * PiHuo final brand mark (PNG).
 * Single source: public `icon.png` (app plate) or `icon-glyph.png` (no black plate).
 */
export function BrandLogo({ className, size = 88, title, variant = 'app' }: BrandLogoProps) {
  const src = brandIconUrl(variant === 'glyph' ? 'icon-glyph.png' : 'icon.png')

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
