export interface RoleReviewPromptContext {
  roleReviewPending: boolean
  bootstrappedRoleCount: number
}

export function buildRoleReviewInstruction(context: RoleReviewPromptContext): string {
  if (!context.roleReviewPending) return ''
  const question =
    context.bootstrappedRoleCount > 0
      ? '已根据 Worker 默认角色创建 Team，是否需要调整 Team？'
      : '当前没有可用的默认 Team 成员，是否需要配置 Team？'
  return `

## One-time role review
- Before dispatching any Worker or starting the requested task, call list-team and ask the user to confirm the bootstrapped Team. Show each enabled member's name, roleType, Worker, and model binding, then ask exactly once: “${question}”
- If the current user message already explicitly names the exact roles and Workers, treat that composition as confirmed. Apply only those authorized Team choices and continue the requested task without asking the generic review question.
- Do not execute the task or create its task list until the user confirms. Do not append the review question after completing the task.
- Do not add, update, archive, replace, or rebind Team members unless the user explicitly authorizes the exact role and Worker.
`
}

export function shouldMarkRoleReviewPrompted(input: {
  roleReviewPending: boolean
  finishReason?: string
}): boolean {
  return input.roleReviewPending && input.finishReason === 'stop'
}
