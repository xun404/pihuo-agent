export interface SettingsSearchOption {
  value: string
  label: string
  description?: string
  /** Secondary line / mono id (e.g. modelId under a friendly label) */
  secondary?: string
  /** Extra text used only for filtering (not rendered). */
  keywords?: string
}

/** Collapse case / separators / parenthetical noise for comparing model name vs id. */
export function compactModelKey(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * True when a display name is just a prettified modelId (common in ACP catalogs).
 * In that case the UI should show a single line (the id) instead of dual truncated columns.
 */
export function isRedundantModelDisplayName(name: string, modelId: string): boolean {
  const a = compactModelKey(name)
  const b = compactModelKey(modelId)
  if (!a || !b) return true
  if (a === b) return true
  const slash = modelId.indexOf('/')
  if (slash > 0) {
    const head = compactModelKey(modelId.slice(0, slash))
    const tail = compactModelKey(modelId.slice(slash + 1))
    // "gpt-4o-mini" / "GPT-4o Mini" or "Provider/Model Name" ≈ provider/model-id
    if (tail && (a === tail || a === head + tail || a === tail + head)) return true
  }
  return false
}

/**
 * Map ACP worker model rows into combobox options.
 * Always use modelId as the only visible label so list rows stay uniform
 * (ACP display names are inconsistent: sometimes prettified id, sometimes
 * product marketing text). Friendly names still match via `keywords`.
 */
export function toWorkerModelSearchOption(option: {
  modelId: string
  name?: string
  description?: string
}): SettingsSearchOption {
  const modelId = option.modelId.trim()
  const name = option.name?.trim() || ''
  const description = option.description?.trim() || undefined
  const keywords =
    name && !isRedundantModelDisplayName(name, modelId) ? name : undefined
  return {
    value: modelId,
    label: modelId,
    description,
    keywords,
  }
}

/**
 * Map ACP reasoning intensity options into combobox rows.
 * Single visible line only — "High" + "high" dual rows are redundant noise.
 * Prefer the display name when present; raw value stays searchable via keywords.
 */
export function toReasoningSearchOption(option: {
  value: string
  name?: string
  description?: string
}): SettingsSearchOption {
  const value = option.value.trim()
  const name = option.name?.trim() || ''
  const description = option.description?.trim() || undefined
  const label = name || value
  const keywords = name && compactModelKey(name) !== compactModelKey(value) ? value : undefined
  return {
    value,
    label,
    description,
    keywords,
  }
}

export function filterSettingsSearchOptions(
  options: SettingsSearchOption[],
  query: string,
  limit?: number,
): SettingsSearchOption[] {
  const normalized = query.trim().toLocaleLowerCase()
  const filtered = normalized
    ? options.filter((option) =>
        [option.label, option.value, option.description, option.secondary, option.keywords]
          .filter((part): part is string => Boolean(part))
          .some((part) => part.toLocaleLowerCase().includes(normalized)),
      )
    : options
  return limit === undefined ? filtered : filtered.slice(0, Math.max(0, limit))
}

export function moveSettingsSearchHighlight(current: number, key: string, count: number): number {
  if (count <= 0) return -1
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count
  if (key === 'ArrowUp') return current < 0 ? count - 1 : (current - 1 + count) % count
  return current
}

export function labelForSettingsSearchValue(
  options: SettingsSearchOption[],
  value: string,
  clearLabel?: string,
): string {
  if (!value) return clearLabel ?? ''
  return options.find((option) => option.value === value)?.label ?? value
}
