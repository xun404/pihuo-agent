/**
 * Tool call display helpers: extract a short command preview for the collapsed
 * chip row, and a terminal-style view (`$ command` + raw text output) for the
 * expanded body. Replaces the previous JSON.stringify detail view.
 */

/** Collapse long tool command preview for the chip row. */
export function toolCommandPreview(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input.replace(/\s+/g, ' ').trim()
  if (typeof input !== 'object') return String(input)
  const o = input as Record<string, unknown>
  for (const key of ['command', 'cmd', 'query', 'path', 'url', 'task', 'code']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim()
  }
  if (Array.isArray(o.args) && o.args.every((a) => typeof a === 'string')) {
    return (o.args as string[]).join(' ')
  }
  try {
    const s = JSON.stringify(input)
    return s.length > 160 ? `${s.slice(0, 157)}…` : s
  } catch {
    return ''
  }
}

/** Multi-line version of the command for the terminal body (no whitespace collapse). */
export function toolCommandFull(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input.trim()
  if (typeof input !== 'object') return String(input)
  const o = input as Record<string, unknown>
  for (const key of ['command', 'cmd', 'query', 'path', 'url', 'task', 'code']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  if (Array.isArray(o.args) && o.args.every((a) => typeof a === 'string')) {
    return (o.args as string[]).join(' ')
  }
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return ''
  }
}

/**
 * Pull a human-readable raw text out of a tool output. Prefers real text
 * fields over a JSON dump so the expanded view feels like a terminal.
 */
export function toolOutputText(output: unknown): string {
  if (output == null) return ''
  if (typeof output === 'string') return output
  if (typeof output !== 'object') return String(output)
  const o = output as Record<string, unknown>
  for (const key of ['output', 'stdout', 'text', 'result', 'content', 'message']) {
    const v = o[key]
    if (typeof v === 'string' && v) return v
  }
  // Nested content arrays (MCP-style): [{ type: 'text', text: '...' }]
  if (Array.isArray(o.content)) {
    const parts = (o.content as unknown[])
      .map((c) => {
        if (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string') {
          return (c as { text: string }).text
        }
        return null
      })
      .filter((s): s is string => Boolean(s))
    if (parts.length > 0) return parts.join('\n')
  }
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return ''
  }
}

export type ToolTerminalView = {
  /** Raw (possibly multi-line) command; empty when unknown. */
  command: string
  /** Raw text output; empty when there is none. */
  stdout: string
  /** Error text; empty when none. */
  stderr: string
}

export function buildToolTerminalView(
  input: unknown,
  output: unknown,
  errorText: string | undefined,
): ToolTerminalView {
  return {
    command: toolCommandFull(input),
    stdout: toolOutputText(output),
    stderr: errorText ?? '',
  }
}
