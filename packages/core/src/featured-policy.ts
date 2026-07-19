import type { RegistrySnapshot } from './registry-snapshot.js'

export interface FeaturedPolicyEntry {
  modelId: string
  tag?: 'flagship' | 'fast' | 'coding' | 'cheap' | 'reasoning'
  sort: number
  hint?: string
}

export interface FeaturedPolicy {
  version: 1
  entries: FeaturedPolicyEntry[]
}

export type CurrentSelectionStatus = 'featured' | 'not_featured' | 'registry_unknown'

export interface FeaturedCatalogResult {
  featured: Array<{
    id: string
    label: string
    providerId: string
    tag?: FeaturedPolicyEntry['tag']
    sort: number
  }>
  currentSelection: null | {
    id: string
    label: string
    providerId: string
    status: CurrentSelectionStatus
  }
}

export function applyFeaturedPolicy(
  snapshot: RegistrySnapshot,
  policy: FeaturedPolicy,
  currentModelId: string | null | undefined,
): FeaturedCatalogResult {
  const byId = new Map<string, { id: string; label: string; providerId: string }>()
  for (const p of snapshot.providers) {
    for (const m of p.models) {
      byId.set(m.id, { id: m.id, label: m.label, providerId: p.id })
    }
  }
  const featured = policy.entries
    .map((e) => {
      const hit = byId.get(e.modelId)
      if (!hit) return null
      return { ...hit, tag: e.tag, sort: e.sort }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.sort - b.sort)

  const cur = currentModelId?.trim() || ''
  if (!cur) return { featured, currentSelection: null }
  const inFeatured = featured.find((m) => m.id === cur)
  if (inFeatured) {
    return {
      featured,
      currentSelection: {
        id: cur,
        label: inFeatured.label,
        providerId: inFeatured.providerId,
        status: 'featured',
      },
    }
  }
  const inReg = byId.get(cur)
  if (inReg) {
    return {
      featured,
      currentSelection: {
        id: cur,
        label: inReg.label,
        providerId: inReg.providerId,
        status: 'not_featured',
      },
    }
  }
  return {
    featured,
    currentSelection: {
      id: cur,
      label: cur,
      providerId: cur.split('/')[0] || cur,
      status: 'registry_unknown',
    },
  }
}
