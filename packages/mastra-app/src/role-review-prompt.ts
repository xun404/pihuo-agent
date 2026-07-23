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
- Complete the user's current request normally; do not block on role confirmation.
- At the very end of this response, ask exactly once: “${question}”
- Do not add, update, archive, or replace Team members unless the user explicitly asks in a later message.
`
}

export function shouldMarkRoleReviewPrompted(input: {
  roleReviewPending: boolean
  finishReason?: string
}): boolean {
  return input.roleReviewPending && input.finishReason === 'stop'
}
