/**
 * Terminal prompt wordmark: `>_Pi_`.
 * Pi sits on a short fixed underline. The prompt stays to the left.
 */
export function BrandLockup({
  className,
  label,
  size = 24,
}: {
  className?: string
  label: string
  size?: number
}) {
  return (
    <span
      className={className}
      role="img"
      aria-label={label}
      title={label}
      style={{ ['--pi-size' as string]: `${size}px` }}
    >
      <span className="brand-prompt" aria-hidden>
        <span className="brand-prompt-sigil">&gt;</span>
        <span className="brand-prompt-mark">
          <span className="brand-prompt-name">Pi</span>
          <span className="brand-prompt-line" />
        </span>
      </span>
    </span>
  )
}
