import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_PROMPT_SETTINGS,
  PROMPT_ROLE_ORDER,
  WORKER_ROLES,
  defaultPromptSettings,
  isValidPromptSettings,
  normalizePromptSettings,
  promptsMatchLocaleDefaults,
} from './index.js'

describe('prompt settings', () => {
  it('ships non-empty zh and en defaults for Leader and every Worker role', () => {
    for (const locale of ['zh', 'en'] as const) {
      const defaults = defaultPromptSettings(locale)
      assert.ok(defaults.leader.trim(), locale)
      assert.deepEqual(Object.keys(defaults.roles).sort(), [...WORKER_ROLES].sort())
      for (const role of WORKER_ROLES) {
        assert.ok(defaults.roles[role].trim(), `${locale}:${role}`)
      }
    }
    assert.deepEqual([...PROMPT_ROLE_ORDER].sort(), [...WORKER_ROLES].sort())
    assert.equal(DEFAULT_PROMPT_SETTINGS.leader, defaultPromptSettings('zh').leader)
  })

  it('gives Leader pragmatic focused tone defaults and upgrades only old built-in values', () => {
    const zh = defaultPromptSettings('zh').leader
    const en = defaultPromptSettings('en').leader

    assert.match(zh, /务实、简洁、直接且专注/u)
    assert.match(zh, /减少非必要的 emoji/u)
    assert.match(zh, /不完全禁止/u)
    assert.match(en, /pragmatic, concise, direct, and focused/u)
    assert.match(en, /Reduce unnecessary emoji/u)
    assert.match(en, /do not prohibit them/u)

    const legacyZh = normalizePromptSettings({
      leader: '准确理解用户目标，优先复用合适的角色完成任务，并清楚说明关键决策、风险和验证结果。',
    })
    const legacyEn = normalizePromptSettings(
      {
        leader:
          'Understand the user goal accurately, prefer reusing the right roles to complete the work, and clearly explain key decisions, risks, and verification results.',
      },
      'en',
    )
    const custom = normalizePromptSettings({ leader: '自定义 Leader 提示' })

    assert.equal(legacyZh.leader, zh)
    assert.equal(legacyEn.leader, en)
    assert.equal(custom.leader, '自定义 Leader 提示')
  })

  it('constrains plan roles to produce a scoped, executable Markdown plan contract', () => {
    const zh = defaultPromptSettings('zh').roles.plan
    const en = defaultPromptSettings('en').roles.plan

    assert.match(zh, /指导性 Markdown plan/u)
    assert.match(zh, /先阅读相关代码、配置和文档/u)
    assert.match(zh, /轻量、标准或严格/u)
    assert.match(zh, /docs\/superpowers\/plans\/YYYY-MM-DD-<topic>\.md/u)
    assert.match(zh, /Todo、Check、Result Return Area/u)
    assert.match(zh, /文档更新结果/u)
    assert.match(zh, /全部验收结束前不要提交 git/u)
    assert.match(zh, /最终只返回 plan 路径/u)
    assert.match(
      zh,
      /禁止输出实现代码、伪代码、diff、完整 proto 或消息定义、SQL 或查询语句、方法体/u,
    )
    assert.match(zh, /文件变更计划只描述文件职责、行为变化和验收结果/u)

    assert.match(en, /guidance-only Markdown plan/u)
    assert.match(en, /read the relevant code, configuration, and documentation first/u)
    assert.match(en, /lightweight, standard, or strict/u)
    assert.match(en, /docs\/superpowers\/plans\/YYYY-MM-DD-<topic>\.md/u)
    assert.match(en, /Todo, Check, and Result Return Area/u)
    assert.match(en, /documentation update result/u)
    assert.match(en, /Do not commit git changes before all acceptance checks pass/u)
    assert.match(en, /return only the plan path/u)
    assert.match(
      en,
      /Do not output implementation code, pseudocode, diffs, complete proto or message definitions, SQL or query statements, or method bodies/u,
    )
    assert.match(
      en,
      /The File Change Plan describes only file responsibilities, behavior changes, and acceptance outcomes/u,
    )
  })

  it('requires every plan to define a downstream Review Todo List', () => {
    const zh = defaultPromptSettings('zh').roles.plan
    const en = defaultPromptSettings('en').roles.plan

    assert.match(zh, /Review Todo List/u)
    assert.match(zh, /每一项关联一个用户验收标准或关键设计决策/u)
    assert.match(zh, /需要检查的行为和证据/u)
    assert.match(zh, /逐项回写 PASS\/FAIL、证据和未覆盖项/u)

    assert.match(en, /Review Todo List/u)
    assert.match(en, /Each checkbox maps to one user acceptance criterion or key design decision/u)
    assert.match(en, /behavior and evidence to inspect/u)
    assert.match(en, /records PASS\/FAIL, evidence, and uncovered gaps/u)
  })

  it('migrates only legacy built-in plan prompts and preserves custom prompts', () => {
    const legacyZh = normalizePromptSettings({
      roles: {
        plan: '作为规划角色，分析目标、约束和代码现状，输出可执行且可验证的步骤；除非明确要求，不直接实施。',
      },
    })
    const legacyEn = normalizePromptSettings({
      roles: {
        plan: 'As a planning role, analyze goals, constraints, and the current codebase; produce executable and verifiable steps. Do not implement unless explicitly asked.',
      },
    })
    const custom = normalizePromptSettings({ roles: { plan: '自定义 plan 提示' } })

    assert.equal(legacyZh.roles.plan, defaultPromptSettings('zh').roles.plan)
    assert.equal(legacyEn.roles.plan, defaultPromptSettings('en').roles.plan)
    assert.equal(custom.roles.plan, '自定义 plan 提示')
  })

  it('normalizes valid fields and falls back invalid fields independently', () => {
    const prompts = normalizePromptSettings({
      leader: '  自定义 Leader  ',
      roles: {
        coder: '  自定义编码  ',
        review: '   ',
      },
    })

    assert.equal(prompts.leader, '自定义 Leader')
    assert.equal(prompts.roles.coder, '自定义编码')
    assert.equal(prompts.roles.review, DEFAULT_PROMPT_SETTINGS.roles.review)
    assert.equal(prompts.roles.general, DEFAULT_PROMPT_SETTINGS.roles.general)
  })

  it('falls back missing fields using the requested locale defaults', () => {
    const en = normalizePromptSettings({ leader: 'Custom leader' }, 'en')
    assert.equal(en.leader, 'Custom leader')
    assert.equal(en.roles.coder, defaultPromptSettings('en').roles.coder)
    assert.notEqual(en.roles.coder, defaultPromptSettings('zh').roles.coder)
  })

  it('returns fresh objects rather than mutable references to built-in defaults', () => {
    const first = normalizePromptSettings(undefined)
    const second = normalizePromptSettings(undefined)

    first.leader = 'changed'
    first.roles.coder = 'changed'

    assert.equal(second.leader, DEFAULT_PROMPT_SETTINGS.leader)
    assert.equal(second.roles.coder, DEFAULT_PROMPT_SETTINGS.roles.coder)
  })

  it('detects locale-built-in defaults for reset UX', () => {
    assert.equal(promptsMatchLocaleDefaults(defaultPromptSettings('zh'), 'zh'), true)
    assert.equal(promptsMatchLocaleDefaults(defaultPromptSettings('en'), 'en'), true)
    assert.equal(promptsMatchLocaleDefaults(defaultPromptSettings('zh'), 'en'), false)
  })

  it('validates only complete non-empty prompt settings for explicit saves', () => {
    assert.equal(isValidPromptSettings(normalizePromptSettings(undefined)), true)
    assert.equal(isValidPromptSettings({ leader: '', roles: DEFAULT_PROMPT_SETTINGS.roles }), false)
    assert.equal(isValidPromptSettings({ leader: 'ok', roles: { general: 'only one' } }), false)
  })
})
