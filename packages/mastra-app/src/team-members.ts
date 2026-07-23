import { evaluateWorkerModelPin } from './worker-models.js'

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
