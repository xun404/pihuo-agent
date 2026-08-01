/**
 * Seed a local showcase project + sample chat history for README screenshots.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSettings, type LocalStore } from '@swarmdesk-agent/core'
import { leaderAgent } from './agents/leader-agent.js'

export type DemoSeedResult = {
  project: ReturnType<LocalStore['upsertProject']>
  session: ReturnType<LocalStore['createSession']>
  secondarySession?: ReturnType<LocalStore['createSession']>
  showcaseRoot: string
  memorySeeded: boolean
}

function resolveShowcaseRoot(explicit?: string): string {
  if (explicit && existsSync(explicit)) return resolve(explicit)
  const env = process.env.SWARMDESK_DEMO_ROOT?.trim()
  if (env && existsSync(env)) return resolve(env)

  // packages/mastra-app/src → repo root
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../../../docs/demo/swarmdesk-showcase'),
    resolve(process.cwd(), 'docs/demo/swarmdesk-showcase'),
    resolve(process.cwd(), '../../docs/demo/swarmdesk-showcase'),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'package.json'))) return c
  }
  // Fall back to monorepo root (legacy demo seed)
  if (process.cwd().endsWith('mastra-app')) return resolve(process.cwd(), '../..')
  return process.cwd()
}

function buildDemoMemoryRows(input: {
  threadId: string
  resourceId: string
  locale: 'zh' | 'en'
}): Record<string, unknown>[] {
  const now = Date.now()
  const t = (offsetMs: number) => new Date(now + offsetMs)
  const userText =
    input.locale === 'en'
      ? 'Summarize open tasks in src/tasks.ts and suggest a review checklist.'
      : '总结 src/tasks.ts 里的待办，并给出一份 review 检查清单。'
  const thinkingText =
    input.locale === 'en'
      ? 'Read the task board, group by status, then draft a short checklist for the review role.'
      : '先读任务板，按状态分组，再给 review 角色写一份简短检查清单。'
  const replyText =
    input.locale === 'en'
      ? `Open board: **1 doing**, **1 todo** (1 done).\n\nReview checklist:\n1. Confirm owner + status in \`src/tasks.ts\`\n2. Cover approval surfaces in chat\n3. Keep showcase seed docs in sync`
      : `当前看板：**1 进行中**，**1 待办**（1 已完成）。\n\nReview 检查清单：\n1. 核对 \`src/tasks.ts\` 的 owner / status\n2. 确认审批入口在对话中可见\n3. 保持 showcase seed 文档同步`

  return [
    {
      id: 'demo-user-1',
      role: 'user',
      createdAt: t(-120_000),
      threadId: input.threadId,
      resourceId: input.resourceId,
      content: {
        format: 2,
        parts: [{ type: 'text', text: userText }],
      },
    },
    {
      id: 'demo-assistant-1',
      role: 'assistant',
      createdAt: t(-90_000),
      threadId: input.threadId,
      resourceId: input.resourceId,
      content: {
        format: 2,
        // Text-only parts — Mastra→AI SDK converters are strict about tool/data shapes.
        parts: [
          {
            type: 'text',
            text:
              input.locale === 'en'
                ? `Thinking: ${thinkingText}\n\n${replyText}`
                : `思考：${thinkingText}\n\n${replyText}`,
          },
        ],
      },
    },
  ]
}

/**
 * Create/update the showcase project, sample sessions, and optional chat history.
 */
export async function seedDemoShowcase(
  store: LocalStore,
  opts?: { rootPath?: string; seedMemory?: boolean },
): Promise<DemoSeedResult> {
  const showcaseRoot = resolveShowcaseRoot(opts?.rootPath)
  const locale = store.getLocale() === 'en' ? 'en' : 'zh'
  const project = store.upsertProject({
    name: 'swarmdesk-showcase',
    rootPath: showcaseRoot,
    defaultBranch: 'main',
  })
  store.setActiveProject(project.id)

  const prompts = loadSettings().prompts.roles
  const session = store.createSession({
    projectId: project.id,
    title: locale === 'en' ? 'Review open tasks' : '复盘待办任务',
    mode: 'build',
    rolePrompts: prompts,
  })
  store.setActiveSession(session.id)

  const secondarySession = store.createSession({
    projectId: project.id,
    title: locale === 'en' ? 'Wire approval UX' : '完善审批交互',
    mode: 'build',
    rolePrompts: prompts,
  })
  // Keep primary session active for screenshots
  store.setActiveSession(session.id)

  let memorySeeded = false
  if (opts?.seedMemory !== false) {
    try {
      const memory = await leaderAgent.getMemory()
      if (memory) {
        const threadId = session.memoryThreadId || session.id
        const resourceId = project.id
        const existing = await memory.getThreadById({ threadId })
        if (!existing) {
          await memory.createThread({ threadId, resourceId })
        }
        await memory.saveMessages({
          messages: buildDemoMemoryRows({
            threadId,
            resourceId,
            locale,
          }) as never,
        })
        memorySeeded = true
      }
    } catch (e) {
      console.warn('[demo-seed] memory seed skipped', e)
    }
  }

  return { project, session, secondarySession, showcaseRoot, memorySeeded }
}
