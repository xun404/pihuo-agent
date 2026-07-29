import { evaluateWorkerModelPin } from './worker-models.js'
import { evaluateWorkerReasoningSelection } from './worker-reasoning.js'

export type RoleModelEvaluator = (
  workerId: string,
  model: string | null | undefined,
  options?: { cwd?: string },
) => { ok: boolean; errorCode?: string; error?: string }

/** Validate only explicit role overrides; an empty model means inheritance. */
export function assertTeamMemberModelAccepted(
  workerId: string,
  model: string | null | undefined,
  cwd?: string,
  evaluate: RoleModelEvaluator = evaluateWorkerModelPin,
): void {
  if (!model?.trim()) return
  const result = evaluate(workerId, model.trim(), { cwd })
  if (!result.ok) {
    throw new Error(
      `${result.errorCode ?? 'MODEL_SELECTION_UNVERIFIED'}: ${
        result.error ?? `Model is not available for Worker ${workerId}`
      }`,
    )
  }
}

/** Validate role reasoning override; an empty reasoning means inheritance. */
export function assertTeamMemberReasoningAccepted(
  workerId: string,
  model: string | undefined,
  reasoning: string | null | undefined,
  opts?: { cwd?: string; scopeKey?: string | null },
): void {
  if (!reasoning?.trim()) return
  const result = evaluateWorkerReasoningSelection(workerId, model, reasoning, opts)
  if (!result.ok) {
    throw new Error(
      `${result.errorCode ?? 'REASONING_SELECTION_UNVERIFIED'}: ${
        result.error ?? `Reasoning value is not available for Worker ${workerId}`
      }`,
    )
  }
}
