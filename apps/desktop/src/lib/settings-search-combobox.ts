export interface SettingsSearchOption {
  value: string
  label: string
  description?: string
  /** Secondary line / mono id (e.g. modelId) */
  secondary?: string
}

export function filterSettingsSearchOptions(
  options: SettingsSearchOption[],
  query: string,
  limit?: number,
): SettingsSearchOption[] {
  const normalized = query.trim().toLocaleLowerCase()
  const filtered = normalized
    ? options.filter((option) =>
        [option.label, option.value, option.description, option.secondary]
          .filter((part): part is string => Boolean(part))
          .some((part) => part.toLocaleLowerCase().includes(normalized)),
      )
    : options
  return limit === undefined ? filtered : filtered.slice(0, Math.max(0, limit))
}

export function moveSettingsSearchHighlight(
  current: number,
  key: string,
  count: number,
): number {
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
