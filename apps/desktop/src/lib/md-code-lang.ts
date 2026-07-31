/** Extract `language-foo` from a react-markdown code className. */
export function languageFromClassName(className?: string | null): string {
  if (!className) return ''
  const m = /language-([\w#+.-]+)/i.exec(className)
  return m?.[1] ?? ''
}
