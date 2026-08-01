import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { BranchInfo, BranchListResult, BranchSwitchResult } from '../lib/api'

export interface UseGitBranchesArgs {
  projectId: string | undefined
  enabled?: boolean
}

export interface UseGitBranchesResult {
  loading: boolean
  isRepo: boolean
  currentBranchName: string | null
  branches: BranchInfo[]
  dirtyFileCount: number
  error: string | null
  mutationPending: boolean
  refresh: () => Promise<void>
  switchTo: (target: string) => Promise<BranchSwitchResult>
  createAndSwitch: (name: string, startPoint?: string) => Promise<BranchSwitchResult>
  commitAndSwitch: (target: string, message: string) => Promise<BranchSwitchResult>
}

const EMPTY: UseGitBranchesResult = {
  loading: false,
  isRepo: false,
  currentBranchName: null,
  branches: [],
  dirtyFileCount: 0,
  error: null,
  mutationPending: false,
  refresh: async () => {},
  switchTo: async () => ({
    ok: false,
    action: 'switch',
    branchName: '',
    didChange: false,
    issues: [],
  }),
  createAndSwitch: async () => ({
    ok: false,
    action: 'create',
    branchName: '',
    didChange: false,
    issues: [],
  }),
  commitAndSwitch: async () => ({
    ok: false,
    action: 'switch',
    branchName: '',
    didChange: false,
    issues: [],
  }),
}

/**
 * Loads local git branches for a project and exposes switch / create / commit-and-switch mutations.
 * Auto-loads on projectId change; refreshes after each successful mutation.
 */
export function useGitBranches({
  projectId,
  enabled = true,
}: UseGitBranchesArgs): UseGitBranchesResult {
  const [loading, setLoading] = useState(false)
  const [isRepo, setIsRepo] = useState(false)
  const [currentBranchName, setCurrentBranchName] = useState<string | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [dirtyFileCount, setDirtyFileCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [mutationPending, setMutationPending] = useState(false)
  const aliveRef = useRef(true)

  const applyList = (r: BranchListResult) => {
    setIsRepo(r.isRepo)
    setCurrentBranchName(r.currentBranchName)
    setBranches(r.branches)
    setDirtyFileCount(r.dirtyFileCount)
    setError(r.ok ? null : (r.error ?? null))
  }

  const refresh = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const r = await api.listBranches(projectId)
      if (aliveRef.current) applyList(r)
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    aliveRef.current = true
    if (!enabled || !projectId) {
      setIsRepo(false)
      setCurrentBranchName(null)
      setBranches([])
      setDirtyFileCount(0)
      setError(null)
      return
    }
    void refresh()
    return () => {
      aliveRef.current = false
    }
  }, [enabled, projectId, refresh])

  const switchTo = useCallback(
    async (target: string): Promise<BranchSwitchResult> => {
      if (!projectId) throw new Error('no project')
      setMutationPending(true)
      try {
        const r = await api.switchBranch(projectId, target)
        if (r.ok && aliveRef.current) {
          setCurrentBranchName(r.currentBranchName ?? target)
          await refresh()
        }
        return r
      } finally {
        if (aliveRef.current) setMutationPending(false)
      }
    },
    [projectId, refresh],
  )

  const createAndSwitch = useCallback(
    async (name: string, startPoint?: string): Promise<BranchSwitchResult> => {
      if (!projectId) throw new Error('no project')
      setMutationPending(true)
      try {
        const r = await api.createBranchAndSwitch(projectId, name, startPoint)
        if (r.ok && aliveRef.current) {
          setCurrentBranchName(r.currentBranchName ?? name)
          await refresh()
        }
        return r
      } finally {
        if (aliveRef.current) setMutationPending(false)
      }
    },
    [projectId, refresh],
  )

  const commitAndSwitchFn = useCallback(
    async (target: string, message: string): Promise<BranchSwitchResult> => {
      if (!projectId) throw new Error('no project')
      setMutationPending(true)
      try {
        const r = await api.commitAndSwitch(projectId, target, message)
        if (r.ok && aliveRef.current) {
          setCurrentBranchName(r.currentBranchName ?? target)
          await refresh()
        }
        return r
      } finally {
        if (aliveRef.current) setMutationPending(false)
      }
    },
    [projectId, refresh],
  )

  if (!projectId || !enabled) return EMPTY
  return {
    loading,
    isRepo,
    currentBranchName,
    branches,
    dirtyFileCount,
    error,
    mutationPending,
    refresh,
    switchTo,
    createAndSwitch,
    commitAndSwitch: commitAndSwitchFn,
  }
}
