/**
 * Official Pi coding-agent mark (https://pi.dev/logo-on-light.svg).
 * Paths are unchanged; fill uses currentColor so light/dark themes both work.
 */
export function PiMark({
  className,
  size = 22,
  title,
}: {
  className?: string
  size?: number
  title?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 800 800"
      fill="currentColor"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29Z M282.65 282.65V400H400V282.65Z"
      />
      <path d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  )
}
