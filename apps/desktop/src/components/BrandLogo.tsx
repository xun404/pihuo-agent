import { useTheme } from '../theme/ThemeProvider'

type BrandLogoProps = {
  className?: string
  size?: number
  /** Accessible label; omit when decorative (parent provides context). */
  title?: string
}

/**
 * Theme-aware SwarmDesk brand mark (honeycomb).
 * Uses light SVG on light surfaces and dark SVG on dark.
 */
export function BrandLogo({ className, size = 88, title }: BrandLogoProps) {
  const { resolved } = useTheme()
  const src = resolved === 'dark' ? '/icon_dark.svg' : '/icon.svg'

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
