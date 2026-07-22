export interface RoleReviewPromptContext {
  roleReviewPending: boolean
  bootstrappedRoleCount: number
}

export function buildRoleReviewInstruction(context: RoleReviewPromptContext): string {
  if (!context.roleReviewPending) return ''
  const question =
    context.bootstrappedRoleCount > 0
      ? '已带入默认角色，是否需要调整角色定义？'
      : '当前没有可用默认角色，是否需要配置角色定义？'
  return `

## One-time role review
- Complete the user's current request normally; do not block on role confirmation.
- At the very end of this response, ask exactly once: “${question}”
- Do not create, update, or archive role definitions unless the user explicitly asks in a later message.
`
}

export function shouldMarkRoleReviewPrompted(input: {
  roleReviewPending: boolean
  finishReason?: string
}): boolean {
  return input.roleReviewPending && input.finishReason === 'stop'
}
