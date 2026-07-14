import type { ApprovalDecision } from '@router-agents/shared'

export type ApprovalWaitOutcome =
  | { outcome: 'selected'; decision: 'allow'; optionId?: string }
  | { outcome: 'cancelled'; decision: 'deny' | 'cancel'; optionId?: string }
  | { outcome: 'timeout' }

export interface WaitForApprovalOptions {
  timeoutMs?: number
  /** Injected clock for tests */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

type Waiter = {
  resolve: (value: ApprovalWaitOutcome) => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * In-process registry: ACP permission parks a promise; resolveApproval settles it.
 */
export class ApprovalWaitRegistry {
  private waiters = new Map<string, Waiter>()

  /**
   * Wait until settle() is called for this approval id, or timeout.
   * On timeout returns { outcome: 'timeout' } and leaves the approval pending in the store
   * (caller may separately cancel).
   */
  wait(approvalId: string, opts: WaitForApprovalOptions = {}): Promise<ApprovalWaitOutcome> {
    const timeoutMs = opts.timeoutMs ?? 120_000

    // If already settled race: create waiter first
    return new Promise<ApprovalWaitOutcome>((resolve) => {
      const existing = this.waiters.get(approvalId)
      if (existing) {
        // replace
        if (existing.timer) clearTimeout(existing.timer)
      }

      const waiter: Waiter = { resolve }
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.waiters.delete(approvalId)
          resolve({ outcome: 'timeout' })
        }, timeoutMs)
      }
      this.waiters.set(approvalId, waiter)
    })
  }

  /**
   * Called when user/API resolves an approval.
   * Returns true if a waiter was waiting.
   */
  settle(
    approvalId: string,
    decision: ApprovalDecision,
    optionId?: string,
  ): boolean {
    const waiter = this.waiters.get(approvalId)
    if (!waiter) return false
    if (waiter.timer) clearTimeout(waiter.timer)
    this.waiters.delete(approvalId)

    if (decision === 'allow') {
      waiter.resolve({ outcome: 'selected', decision: 'allow', optionId })
    } else {
      waiter.resolve({
        outcome: 'cancelled',
        decision: decision === 'deny' ? 'deny' : 'cancel',
        optionId,
      })
    }
    return true
  }

  /**
   * Cancel all pending waiters by approval ids. Idempotent.
   */
  cancelMany(approvalIds: string[]): void {
    for (const id of approvalIds) {
      if (!this.has(id)) continue
      this.settle(id, 'cancel')
    }
  }

  has(approvalId: string): boolean {
    return this.waiters.has(approvalId)
  }

  /** Test helper: clear all waiters */
  clear(): void {
    for (const w of this.waiters.values()) {
      if (w.timer) clearTimeout(w.timer)
    }
    this.waiters.clear()
  }

  size(): number {
    return this.waiters.size
  }
}

/** Process-wide default used by store + ACP tools */
export const globalApprovalWaiters = new ApprovalWaitRegistry()

/**
 * High-level helper for ACP onPermissionRequest:
 * enqueue first, then wait for UI/API resolve.
 */
export async function waitForApprovalDecision(
  approvalId: string,
  opts: WaitForApprovalOptions & {
    registry?: ApprovalWaitRegistry
  } = {},
): Promise<ApprovalWaitOutcome> {
  const registry = opts.registry ?? globalApprovalWaiters
  return registry.wait(approvalId, opts)
}
