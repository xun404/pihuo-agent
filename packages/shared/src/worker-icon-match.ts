/** Tokens too generic to score an icon match alone. */
const GENERIC_TOKENS = new Set([
  'cli',
  'acp',
  'agent',
  'code',
  'bin',
  'app',
  'the',
  'and',
  'for',
  'sdk',
  'api',
])

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t))
}

/**
 * Best-effort fuzzy match of a custom-registered worker (by name + command)
 * against a registry agent catalog, so a manually-added CLI can reuse an
 * agent's icon. Returns the agent id or undefined.
 *
 * Matching priority:
 *  1. command/package contains the agent id
 *  2. name matches agent id or display name (substring either direction)
 *  3. concatenated name tokens match id (e.g. "Open Code" → opencode)
 *  4. distinctive token overlap between name/command and agent id/name
 */
export function matchRegistryAgentForIcon(
  name: string,
  command: string,
  agents: readonly { id: string; name: string }[],
): string | undefined {
  if (agents.length === 0) return undefined
  const hay = `${name} ${command}`.toLowerCase()
  // 1. command/package contains agent id
  for (const a of agents) {
    if (command.toLowerCase().includes(a.id.toLowerCase())) return a.id
  }
  // 2. name matches agent id or display name (substring either direction)
  const nameLower = name.toLowerCase().trim()
  if (nameLower) {
    for (const a of agents) {
      const aid = a.id.toLowerCase()
      const aname = a.name.toLowerCase()
      if (
        hay.includes(aid) ||
        hay.includes(aname) ||
        aname.includes(nameLower) ||
        aid.includes(nameLower) ||
        nameLower.includes(aname) ||
        nameLower.includes(aid)
      ) {
        return a.id
      }
    }
  }
  // 3. "Open Code" / "open-code" → opencode
  const nameTokens = tokenize(nameLower)
  const joinedName = nameTokens.join('')
  if (joinedName.length >= 4) {
    for (const a of agents) {
      const compactId = a.id.toLowerCase().replace(/[^a-z0-9]/g, '')
      const compactName = a.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (compactId === joinedName || compactName === joinedName) return a.id
      if (compactId.includes(joinedName) || joinedName.includes(compactId)) return a.id
    }
  }

  // 4. distinctive token overlap (e.g. "claude helper" vs "claude-acp")
  const queryTokens = new Set([...tokenize(command), ...nameTokens])
  if (queryTokens.size === 0) return undefined

  let best: { id: string; score: number } | undefined
  for (const a of agents) {
    const agentTokens = new Set([...tokenize(a.id), ...tokenize(a.name)])
    let overlap = 0
    for (const t of agentTokens) {
      if (queryTokens.has(t)) overlap += 1
    }
    if (overlap > 0 && (!best || overlap > best.score)) best = { id: a.id, score: overlap }
  }
  return best?.id
}
