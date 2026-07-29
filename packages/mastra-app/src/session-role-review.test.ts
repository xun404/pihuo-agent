import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Team review prompt distinguishes bootstrapped and empty Sessions and only completes on stop', async () => {
  const sourceUrl = new URL('./role-review-prompt.ts', import.meta.url)
  const moduleUrl = new URL('./role-review-prompt.js', import.meta.url)
  assert.equal(existsSync(fileURLToPath(sourceUrl)), true, 'role-review prompt helper must exist')

  const module = (await import(moduleUrl.href)) as {
    buildRoleReviewInstruction: (input: {
      roleReviewPending: boolean
      bootstrappedRoleCount: number
    }) => string
    shouldMarkRoleReviewPrompted: (input: {
      roleReviewPending: boolean
      finishReason?: string
    }) => boolean
  }

  const bootstrappedInstruction = module.buildRoleReviewInstruction({
    roleReviewPending: true,
    bootstrappedRoleCount: 2,
  })
  assert.match(bootstrappedInstruction, /Worker 默认角色创建 Team.*是否需要调整 Team/u)
  assert.match(
    bootstrappedInstruction,
    /Before dispatching any Worker or starting the requested task, call list-team and ask the user to confirm the bootstrapped Team/u,
  )
  assert.match(
    bootstrappedInstruction,
    /Do not execute the task or create its task list until the user confirms/u,
  )
  assert.match(
    bootstrappedInstruction,
    /If the current user message already explicitly names the exact roles and Workers, treat that composition as confirmed/u,
  )
  assert.match(
    bootstrappedInstruction,
    /Do not append the review question after completing the task/u,
  )
  assert.doesNotMatch(bootstrappedInstruction, /at the very end of this response/u)
  assert.match(
    module.buildRoleReviewInstruction({ roleReviewPending: true, bootstrappedRoleCount: 0 }),
    /当前没有可用的默认 Team 成员.*是否需要配置 Team/u,
  )
  assert.equal(
    module.buildRoleReviewInstruction({ roleReviewPending: false, bootstrappedRoleCount: 2 }),
    '',
  )
  assert.equal(
    module.shouldMarkRoleReviewPrompted({ roleReviewPending: true, finishReason: 'stop' }),
    true,
  )
  assert.equal(
    module.shouldMarkRoleReviewPrompted({ roleReviewPending: true, finishReason: 'error' }),
    false,
  )
  assert.equal(
    module.shouldMarkRoleReviewPrompted({ roleReviewPending: false, finishReason: 'stop' }),
    false,
  )
})

test('chat route injects role-review context and marks it only through the success guard', () => {
  const source = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')

  assert.match(source, /requestContext\.set\('roleReviewPending'/u)
  assert.match(source, /requestContext\.set\(\s*'bootstrappedRoleCount'/u)
  assert.match(source, /shouldMarkRoleReviewPrompted/u)
  assert.match(source, /markSessionRoleReviewPrompted/u)
})
