/** Match an exact slash-delimited route pattern and decode named parameters. */
export function match(path: string, pattern: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const sp = path.split('/').filter(Boolean)
  if (pp.length !== sp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    const a = pp[i]!
    const b = sp[i]!
    if (a.startsWith(':')) {
      try {
        params[a.slice(1)] = decodeURIComponent(b)
      } catch {
        // A malformed percent escape is not a server failure and must not
        // escape route matching as a 500 response.
        return null
      }
    } else if (a !== b) return null
  }
  return params
}
