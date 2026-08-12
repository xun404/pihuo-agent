import { WORKER_ROLES, type WorkerRole } from './contracts/roles.js'

export interface PromptSettings {
  leader: string
  roles: Record<WorkerRole, string>
}

/** Non-secret user-facing deadlines for scheduled Worker jobs. */
export interface WorkerTimeoutSettings {
  jobTimeoutMs: number
  queueTimeoutMs: number
}

/** Locale used only for built-in default prompt text (UI language). */
export type PromptLocale = 'zh' | 'en'

/** Map any UI locale to the prompt-default catalog (zh covers simplified + traditional). */
export function toPromptLocale(locale: string | undefined | null): PromptLocale {
  if (!locale) return 'zh'
  return locale === 'en' || locale.startsWith('en') ? 'en' : 'zh'
}

const LEGACY_PLAN_PROMPT_ZH =
  '作为规划角色，分析目标、约束和代码现状，输出可执行且可验证的步骤；除非明确要求，不直接实施。'
const LEGACY_PLAN_PROMPT_EN =
  'As a planning role, analyze goals, constraints, and the current codebase; produce executable and verifiable steps. Do not implement unless explicitly asked.'
const LEGACY_LEADER_PROMPT_ZH =
  '准确理解用户目标，优先复用合适的角色完成任务，并清楚说明关键决策、风险和验证结果。'
const LEGACY_LEADER_PROMPT_EN =
  'Understand the user goal accurately, prefer reusing the right roles to complete the work, and clearly explain key decisions, risks, and verification results.'

/** Pre-emoji-guidance Worker role defaults — migrate exact matches to current built-ins. */
const LEGACY_ROLE_PROMPTS_ZH = {
  general: '作为通用执行角色，完成 Leader 委派的任务并返回清晰、可验证的结果。',
  plan: '作为规划角色，只生成供其他 Agent 或工程师执行的指导性 Markdown plan，不直接实现代码。先阅读相关代码、配置和文档，定位真实入口、关键调用链与测试位置；根据范围和风险选择轻量、标准或严格档位，在 plan 中写明档位和原因，能用轻量就不扩写。除非用户指定其他路径，将中文 plan 写入 docs/superpowers/plans/YYYY-MM-DD-<topic>.md。步骤只需定位到相关文件、方法、字段、断言或验证命令，并区分代码事实、需验证假设与非目标。文件变更计划只描述文件职责、行为变化和验收结果，不写具体实现方式。禁止输出实现代码、伪代码、diff、完整 proto 或消息定义、SQL 或查询语句、方法体；也不要替 coder 决定具体语法、控制流或代码结构。所有 plan 必须包含目标、范围、计划档位、当前诊断、文件变更计划、任务拆分、测试与验证计划、文档更新要求、Todo、Check、Review Todo List 和 Result Return Area；标准或严格 plan 再按复杂度补充需求拆解、调用链、关键字段、风险与测试矩阵。Review Todo List 供后续 review 角色逐项验收，每一项关联一个用户验收标准或关键设计决策，使用复选框写明需要检查的行为和证据；它只定义审查目标和所需证据，不写实现代码，也不预判审查结论。要求 review 角色按 Review Todo List 逐项回写 PASS/FAIL、证据和未覆盖项。要求执行者完成后回写 Todo、Check、Result Return Area 和文档更新结果，并明确全部验收结束前不要提交 git。不要声称尚未验证的问题已经修复。最终只返回 plan 路径和这段提示，不复述整份 plan：请严格根据 plan 执行，如有问题先表述出来。任务结束后请更新 plan 中的 Todo、Check 和 Result Return Area。全部验收结束前不要提交 git。计划文件：<path>',
  coder: '作为实现角色，根据任务修改代码，遵循现有架构，并运行相关验证后返回结果。',
  review: '作为审查角色，优先发现正确性、安全性、兼容性和测试缺口，按严重程度给出可定位的问题。',
  test: '作为测试角色，设计并执行与风险匹配的测试，报告可复现的失败、覆盖范围和验证结果。',
  research: '作为研究角色，收集并核验相关事实，区分证据与推断，返回来源、结论和未决问题。',
} as const satisfies Readonly<Record<WorkerRole, string>>

const LEGACY_ROLE_PROMPTS_EN = {
  general:
    'As a general execution role, complete tasks delegated by the Leader and return clear, verifiable results.',
  plan: 'As a planning role, produce only a guidance-only Markdown plan for another Agent or engineer; do not implement code, and read the relevant code, configuration, and documentation first to locate real entry points, the key call chain, and test locations. Select a lightweight, standard, or strict tier from scope and risk, state the tier and reason in the plan, and prefer the smallest sufficient tier. Unless the user provides another path, write the plan in Chinese to docs/superpowers/plans/YYYY-MM-DD-<topic>.md. Locate steps to relevant files, methods, fields, assertions, or verification commands, and distinguish code facts, hypotheses requiring verification, and non-goals. The File Change Plan describes only file responsibilities, behavior changes, and acceptance outcomes, not concrete implementation. Do not output implementation code, pseudocode, diffs, complete proto or message definitions, SQL or query statements, or method bodies; do not decide concrete syntax, control flow, or code structure for the coder. Every plan must include Goal, Scope, Plan Tier, Current Diagnosis, File Change Plan, Task Breakdown, Test and Verification Plan, Documentation Update Requirements, Todo, Check, and Result Return Area, plus a Review Todo List; add requirements, call chain, key fields, risks, and a test matrix only when the standard or strict tier needs them. The Review Todo List is for downstream review. Each checkbox maps to one user acceptance criterion or key design decision and states the behavior and evidence to inspect; it defines review targets and required evidence only, contains no implementation code, and does not prejudge the review outcome. The review role processes every Review Todo List item and records PASS/FAIL, evidence, and uncovered gaps. Require the executor to update Todo, Check, Result Return Area, and the documentation update result after execution. Do not claim an unverified issue is fixed. Do not commit git changes before all acceptance checks pass. In the final response, return only the plan path and this execution reminder without repeating the plan: 请严格根据 plan 执行，如有问题先表述出来。任务结束后请更新 plan 中的 Todo、Check 和 Result Return Area。全部验收结束前不要提交 git。计划文件：<path>',
  coder:
    'As an implementation role, modify code according to the task, follow the existing architecture, run relevant verification, and return results.',
  review:
    'As a review role, prioritize correctness, security, compatibility, and testing gaps; report actionable issues ordered by severity.',
  test: 'As a testing role, design and run risk-matched tests; report reproducible failures, coverage, and verification outcomes.',
  research:
    'As a research role, gather and verify relevant facts, separate evidence from inference, and return sources, conclusions, and open questions.',
} as const satisfies Readonly<Record<WorkerRole, string>>

const WORKER_EMOJI_GUIDANCE_ZH =
  '回复保持务实、简洁；非必要不要使用 emoji，仅在确实有助于表达时使用，但不完全禁止。'
const WORKER_EMOJI_GUIDANCE_EN =
  'Keep replies pragmatic and concise. Avoid emoji unless they materially improve clarity; do not prohibit them entirely.'

const DEFAULT_PROMPT_SETTINGS_ZH = {
  leader:
    '准确理解用户目标，优先复用合适的角色完成任务，并清楚说明关键决策、风险和验证结果。语气保持务实、简洁、直接且专注；减少非必要的 emoji，仅在确实有助于表达时使用，但不完全禁止。',
  roles: {
    general: `作为通用执行角色，完成 Leader 委派的任务并返回清晰、可验证的结果。${WORKER_EMOJI_GUIDANCE_ZH}`,
    plan: `${LEGACY_ROLE_PROMPTS_ZH.plan} ${WORKER_EMOJI_GUIDANCE_ZH}`,
    coder: `作为实现角色，根据任务修改代码，遵循现有架构，并运行相关验证后返回结果。${WORKER_EMOJI_GUIDANCE_ZH}`,
    review: `作为审查角色，优先发现正确性、安全性、兼容性和测试缺口，按严重程度给出可定位的问题。${WORKER_EMOJI_GUIDANCE_ZH}`,
    test: `作为测试角色，设计并执行与风险匹配的测试，报告可复现的失败、覆盖范围和验证结果。${WORKER_EMOJI_GUIDANCE_ZH}`,
    research: `作为研究角色，收集并核验相关事实，区分证据与推断，返回来源、结论和未决问题。${WORKER_EMOJI_GUIDANCE_ZH}`,
  },
} as const satisfies {
  leader: string
  roles: Readonly<Record<WorkerRole, string>>
}

const DEFAULT_PROMPT_SETTINGS_EN = {
  leader:
    'Understand the user goal accurately, prefer reusing the right roles to complete the work, and clearly explain key decisions, risks, and verification results. Keep the tone pragmatic, concise, direct, and focused. Reduce unnecessary emoji and use them only when they materially improve clarity; do not prohibit them.',
  roles: {
    general: `As a general execution role, complete tasks delegated by the Leader and return clear, verifiable results. ${WORKER_EMOJI_GUIDANCE_EN}`,
    plan: `${LEGACY_ROLE_PROMPTS_EN.plan} ${WORKER_EMOJI_GUIDANCE_EN}`,
    coder: `As an implementation role, modify code according to the task, follow the existing architecture, run relevant verification, and return results. ${WORKER_EMOJI_GUIDANCE_EN}`,
    review: `As a review role, prioritize correctness, security, compatibility, and testing gaps; report actionable issues ordered by severity. ${WORKER_EMOJI_GUIDANCE_EN}`,
    test: `As a testing role, design and run risk-matched tests; report reproducible failures, coverage, and verification outcomes. ${WORKER_EMOJI_GUIDANCE_EN}`,
    research: `As a research role, gather and verify relevant facts, separate evidence from inference, and return sources, conclusions, and open questions. ${WORKER_EMOJI_GUIDANCE_EN}`,
  },
} as const satisfies {
  leader: string
  roles: Readonly<Record<WorkerRole, string>>
}

function migrateLegacyPlanPrompt(prompt: string): string {
  if (prompt === LEGACY_PLAN_PROMPT_ZH) return DEFAULT_PROMPT_SETTINGS_ZH.roles.plan
  if (prompt === LEGACY_PLAN_PROMPT_EN) return DEFAULT_PROMPT_SETTINGS_EN.roles.plan
  // Pre-emoji built-in plan text
  if (prompt === LEGACY_ROLE_PROMPTS_ZH.plan) return DEFAULT_PROMPT_SETTINGS_ZH.roles.plan
  if (prompt === LEGACY_ROLE_PROMPTS_EN.plan) return DEFAULT_PROMPT_SETTINGS_EN.roles.plan
  return prompt
}

function migrateLegacyLeaderPrompt(prompt: string): string {
  if (prompt === LEGACY_LEADER_PROMPT_ZH) return DEFAULT_PROMPT_SETTINGS_ZH.leader
  if (prompt === LEGACY_LEADER_PROMPT_EN) return DEFAULT_PROMPT_SETTINGS_EN.leader
  return prompt
}

function migrateLegacyRolePrompt(role: WorkerRole, prompt: string): string {
  if (role === 'plan') return migrateLegacyPlanPrompt(prompt)
  if (prompt === LEGACY_ROLE_PROMPTS_ZH[role]) return DEFAULT_PROMPT_SETTINGS_ZH.roles[role]
  if (prompt === LEGACY_ROLE_PROMPTS_EN[role]) return DEFAULT_PROMPT_SETTINGS_EN.roles[role]
  return prompt
}

/** Built-in defaults (Chinese). Prefer `defaultPromptSettings(locale)` for locale-aware UI. */
export const DEFAULT_PROMPT_SETTINGS: Readonly<{
  leader: string
  roles: Readonly<Record<WorkerRole, string>>
}> = DEFAULT_PROMPT_SETTINGS_ZH

/** Fresh copy of built-in prompt defaults for the given UI locale. */
export function defaultPromptSettings(locale: PromptLocale = 'zh'): PromptSettings {
  const source = locale === 'en' ? DEFAULT_PROMPT_SETTINGS_EN : DEFAULT_PROMPT_SETTINGS_ZH
  return {
    leader: source.leader,
    roles: { ...source.roles },
  }
}

/** True when prompts equal the built-in defaults for the given locale. */
export function promptsMatchLocaleDefaults(
  prompts: PromptSettings,
  locale: PromptLocale = 'zh',
): boolean {
  const defaults = defaultPromptSettings(locale)
  if (prompts.leader.trim() !== defaults.leader.trim()) return false
  return WORKER_ROLES.every((role) => prompts.roles[role].trim() === defaults.roles[role].trim())
}

export function normalizePromptSettings(
  input: unknown,
  locale: PromptLocale = 'zh',
): PromptSettings {
  const defaults = defaultPromptSettings(locale)
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const rawLeader = (raw as { leader?: unknown }).leader
  const rawRolesValue = (raw as { roles?: unknown }).roles
  const rawRoles =
    rawRolesValue && typeof rawRolesValue === 'object' && !Array.isArray(rawRolesValue)
      ? (rawRolesValue as Record<string, unknown>)
      : {}
  const normalizedRoles = {} as Record<WorkerRole, string>
  for (const role of WORKER_ROLES) {
    const candidate = rawRoles[role]
    const normalizedCandidate = typeof candidate === 'string' ? candidate.trim() : ''
    normalizedRoles[role] = normalizedCandidate
      ? migrateLegacyRolePrompt(role, normalizedCandidate)
      : defaults.roles[role]
  }
  return {
    leader:
      typeof rawLeader === 'string' && rawLeader.trim()
        ? migrateLegacyLeaderPrompt(rawLeader.trim())
        : defaults.leader,
    roles: normalizedRoles,
  }
}

export function isValidPromptSettings(input: unknown): input is PromptSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const candidate = input as { leader?: unknown; roles?: unknown }
  if (typeof candidate.leader !== 'string' || !candidate.leader.trim()) return false
  if (!candidate.roles || typeof candidate.roles !== 'object' || Array.isArray(candidate.roles)) {
    return false
  }
  const roles = candidate.roles as Record<string, unknown>
  return WORKER_ROLES.every(
    (role) => typeof roles[role] === 'string' && Boolean((roles[role] as string).trim()),
  )
}

export const DEFAULT_GENERAL_ROLE_INSTRUCTIONS = DEFAULT_PROMPT_SETTINGS.roles.general

export function normalizeWorkerDefaultRoleType(value: unknown): WorkerRole {
  return typeof value === 'string' && WORKER_ROLES.includes(value as WorkerRole)
    ? (value as WorkerRole)
    : 'general'
}

/**
 * A Chat-scoped Team member bound to an installed ACP Worker.
 * Multiple members may bind the same Worker while retaining independent ACP sessions.
 */
