import type { ApprovalDecision } from '@swarmdesk-agent/shared'

export type ApprovalWaitOutcome =
  | { outcome: 'selected'; decision: 'allow' | 'deny'; optionId?: string }
  | { outcome: 'cancelled'; decision: 'cancel'; optionId?: string }

type Waiter = {
  resolve: (value: ApprovalWaitOutcome) => void
  reject: (reason: Error) => void
}

/**
 * In-process registry: ACP permission parks a promise; resolveApproval settles it.
 */
export class ApprovalWaitRegistry {
  private waiters = new Map<string, Waiter>()

  /**
   * Register a waiter that resolves on settle() or rejects on cancel().
   * Same as wait() with no timeout. Used for ACP permission flow.
   */
  register(approvalId: string): Promise<ApprovalWaitOutcome> {
    if (this.waiters.has(approvalId)) {
      throw new Error(`Approval waiter already registered: ${approvalId}`)
    }

    return new Promise<ApprovalWaitOutcome>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject }
      this.waiters.set(approvalId, waiter)
    })
  }

  /** Backwards-compatible alias; approvals intentionally have no timeout. */
  wait(approvalId: string): Promise<ApprovalWaitOutcome> {
    return this.register(approvalId)
  }

  /**
   * Called when user/API resolves an approval.
   * Returns true if a waiter was waiting.
   */
  settle(approvalId: string, decision: ApprovalDecision, optionId?: string): boolean {
    const waiter = this.waiters.get(approvalId)
    if (!waiter) return false
    this.waiters.delete(approvalId)

    if (decision === 'cancel') {
      waiter.resolve({ outcome: 'cancelled', decision: 'cancel', optionId })
    } else {
      waiter.resolve({ outcome: 'selected', decision, optionId })
    }
    return true
  }

  /**
   * Cancel a single waiter, rejecting with the given reason.
   */
  cancel(approvalId: string, reason?: string): boolean {
    const waiter = this.waiters.get(approvalId)
    if (!waiter) return false
    this.waiters.delete(approvalId)
    waiter.reject(new Error(reason ?? 'approval cancelled'))
    return true
  }

  /**
   * Cancel all pending waiters by approval ids. Idempotent.
   * When reason is provided, each waiter is rejected with that reason.
   * Otherwise, settles as 'cancel' (backwards compatibility).
   */
  cancelMany(approvalIds: string[], reason?: string): void {
    for (const id of approvalIds) {
      this.cancel(id, reason ?? 'approval cancelled')
    }
  }

  has(approvalId: string): boolean {
    return this.waiters.has(approvalId)
  }

  /** Test helper: clear all waiters. */
  clear(): void {
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
  opts: { registry?: ApprovalWaitRegistry } = {},
): Promise<ApprovalWaitOutcome> {
  const registry = opts.registry ?? globalApprovalWaiters
  return registry.wait(approvalId)
}
