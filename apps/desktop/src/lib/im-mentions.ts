export type MentionCandidate = {
  id: string
  name: string
  subtitle?: string
}

type MentionMember = {
  id: string
  name: string
  roleType: string
  workerId: string
  enabled: boolean
  archivedAt?: string
}

/** Leader first, then enabled unarchived members. Subtitle is `role · Worker`. */
export function teamMentionCandidates(
  leaderName: string,
  members: readonly MentionMember[],
  workers: readonly { id: string; name: string }[] = [],
): MentionCandidate[] {
  const workerName = new Map(workers.map((worker) => [worker.id, worker.name]))
  const people = members
    .filter((member) => member.enabled && !member.archivedAt)
    .map((member) => {
      const worker = workerName.get(member.workerId)
      return {
        id: member.id,
        name: member.name,
        subtitle: worker ? `${member.roleType} · ${worker}` : member.roleType,
      }
    })
  return [{ id: 'leader', name: leaderName }, ...people]
}

export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, caret))
  const match = before.match(/(^|[\s])@([^\s@]*)$/)
  if (!match) return null
  const query = match[2] ?? ''
  const start = before.length - query.length - 1
  return { start, query }
}

export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...candidates]
  return candidates.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) || item.subtitle?.toLowerCase().includes(needle),
  )
}

export function insertMention(
  text: string,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const found = mentionQueryAt(text, caret)
  if (!found) {
    const next = `${text.slice(0, caret)}@${name} ${text.slice(caret)}`
    return { text: next, caret: caret + name.length + 2 }
  }
  const next = `${text.slice(0, found.start)}@${name} ${text.slice(caret)}`
  return { text: next, caret: found.start + name.length + 2 }
}

export function mentionPattern(names: readonly string[]): RegExp | null {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  if (unique.length === 0) return null
  const escaped = unique.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`@(${escaped.join('|')})(?=$|\\s|[，。！？,.!?])`, 'g')
}

export type MentionSegment = { type: 'text'; value: string } | { type: 'mention'; value: string }

export function splitMentions(text: string, names: readonly string[]): MentionSegment[] {
  const pattern = mentionPattern(names)
  if (!pattern) return [{ type: 'text', value: text }]
  const segments: MentionSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ type: 'text', value: text.slice(cursor, index) })
    segments.push({ type: 'mention', value: match[1] ?? match[0]!.slice(1) })
    cursor = index + match[0]!.length
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) })
  return segments
}
