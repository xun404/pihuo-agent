/**
 * Minimal unified-diff parser for the changed-files viewer.
 */

export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'ctx' | 'other'

export type DiffLine = {
  kind: DiffLineKind
  text: string
  /** Display without leading +/-/space when applicable */
  content: string
  oldNo: number | null
  newNo: number | null
}

export function parseUnifiedDiff(patch: string): DiffLine[] {
  if (!patch) return []
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  for (const raw of patch.split(/\r?\n/)) {
    if (
      raw.startsWith('diff ') ||
      raw.startsWith('index ') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('old mode') ||
      raw.startsWith('new mode') ||
      raw.startsWith('similarity ') ||
      raw.startsWith('rename ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ')
    ) {
      out.push({ kind: 'meta', text: raw, content: raw, oldNo: null, newNo: null })
      continue
    }
    const hunk = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
    if (hunk) {
      oldNo = Number(hunk[1]) || 0
      newNo = Number(hunk[2]) || 0
      out.push({ kind: 'hunk', text: raw, content: raw, oldNo: null, newNo: null })
      continue
    }
    if (raw.startsWith('+')) {
      out.push({
        kind: 'add',
        text: raw,
        content: raw.slice(1),
        oldNo: null,
        newNo: newNo++,
      })
      continue
    }
    if (raw.startsWith('-')) {
      out.push({
        kind: 'del',
        text: raw,
        content: raw.slice(1),
        oldNo: oldNo++,
        newNo: null,
      })
      continue
    }
    if (raw.startsWith(' ') || raw === '') {
      const content = raw.startsWith(' ') ? raw.slice(1) : raw
      out.push({
        kind: 'ctx',
        text: raw || ' ',
        content,
        oldNo: oldNo++,
        newNo: newNo++,
      })
      continue
    }
    if (raw.startsWith('\\')) {
      out.push({ kind: 'other', text: raw, content: raw, oldNo: null, newNo: null })
      continue
    }
    out.push({ kind: 'other', text: raw, content: raw, oldNo: null, newNo: null })
  }
  return out
}

export type SideCellKind = 'add' | 'del' | 'ctx' | 'empty' | 'meta'

export type SideBySideRow = {
  /** Full-width header (hunk/meta) */
  full?: { kind: 'hunk' | 'meta' | 'other'; content: string }
  left: { no: number | null; content: string; kind: SideCellKind }
  right: { no: number | null; content: string; kind: SideCellKind }
}

/** Pair unified lines into side-by-side rows (OpenChamber-style). */
export function toSideBySideRows(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.kind === 'meta' || line.kind === 'hunk' || line.kind === 'other') {
      rows.push({
        full: { kind: line.kind === 'hunk' ? 'hunk' : line.kind === 'meta' ? 'meta' : 'other', content: line.content },
        left: { no: null, content: '', kind: 'empty' },
        right: { no: null, content: '', kind: 'empty' },
      })
      i++
      continue
    }
    if (line.kind === 'ctx') {
      rows.push({
        left: { no: line.oldNo, content: line.content, kind: 'ctx' },
        right: { no: line.newNo, content: line.content, kind: 'ctx' },
      })
      i++
      continue
    }
    const dels: DiffLine[] = []
    while (i < lines.length && lines[i]!.kind === 'del') dels.push(lines[i++]!)
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i]!.kind === 'add') adds.push(lines[i++]!)
    const n = Math.max(dels.length, adds.length)
    for (let j = 0; j < n; j++) {
      const d = dels[j]
      const a = adds[j]
      rows.push({
        left: d
          ? { no: d.oldNo, content: d.content, kind: 'del' }
          : { no: null, content: '', kind: 'empty' },
        right: a
          ? { no: a.newNo, content: a.content, kind: 'add' }
          : { no: null, content: '', kind: 'empty' },
      })
    }
  }
  return rows
}
