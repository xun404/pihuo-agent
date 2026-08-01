/**
 * Tool call display helpers: extract a short command preview for the collapsed
 * chip row, and a readable view for the expanded body. Command-like values
 * remain terminal text; record values become labelled fields without JSON
 * punctuation.
 */

export type ToolField = {
  key: string
  value?: string
  children?: ToolField[]
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function fieldValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value || '—'
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    if (
      value.every(
        (item) => item == null || ['string', 'number', 'boolean', 'bigint'].includes(typeof item),
      )
    ) {
      return value.map(fieldValue).join(', ')
    }
    return `${value.length} items`
  }
  const record = recordValue(value)
  if (record) {
    const count = Object.keys(record).length
    return count > 0 ? `${count} fields` : '—'
  }
  return String(value)
}

/** Convert an arbitrary record into one-level readable key/value groups. */
export function toolStructuredFields(value: unknown): ToolField[] {
  const record = recordValue(value)
  if (!record) return []

  return Object.entries(record).map(([key, entry]) => {
    const nested = recordValue(entry)
    if (nested && Object.keys(nested).length > 0) {
      return {
        key,
        children: Object.entries(nested).map(([childKey, childValue]) => ({
          key: childKey,
          value: fieldValue(childValue),
        })),
      }
    }
    return { key, value: fieldValue(entry) }
  })
}

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
  const first = toolStructuredFields(input)[0]
  if (!first) return ''
  const value = first.children?.[0]?.value ?? first.value
  const preview = value ? `${first.key}: ${value}` : first.key
  return preview.length > 160 ? `${preview.slice(0, 157)}…` : preview
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
  return ''
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
  return ''
}

export type ToolTerminalView = {
  /** Raw (possibly multi-line) command; empty when unknown. */
  command: string
  /** Raw text output; empty when there is none. */
  stdout: string
  /** Error text; empty when none. */
  stderr: string
  /** Non-command input rendered as labelled fields. */
  inputFields: ToolField[]
  /** Non-text output rendered as labelled fields. */
  outputFields: ToolField[]
}

export function buildToolTerminalView(
  input: unknown,
  output: unknown,
  errorText: string | undefined,
): ToolTerminalView {
  const command = toolCommandFull(input)
  const stdout = toolOutputText(output)
  return {
    command,
    stdout,
    stderr: errorText ?? '',
    inputFields: command ? [] : toolStructuredFields(input),
    outputFields: stdout ? [] : toolStructuredFields(output),
  }
}
