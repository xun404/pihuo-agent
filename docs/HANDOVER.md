# SwarmDesk — 交接文档（Plan & Status）

> **仓库**：https://github.com/xun404/swarmdesk-agent
> **默认分支**：`main`
> **本地数据**：`~/.config/swarmdesk-agent/`（根=配置 settings/secrets.enc；`data/`=state/runtime/sessions/mastra-memory.db；`cache/`=可重建缓存）
> **文档日期**：2026-07-17（含 ACP Registry 全量 Agent 接入地基 + Session 复用/审批）

本文档描述：**产品定位、架构、已完成、进行中、待办、风险与本地运维**，供接手同学快速对齐。

---

## 1. 产品是什么

**SwarmDesk** 是 macOS 桌面「多智能体指挥台」：

| 角色        | 实现                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Leader**  | Mastra Agent（`swarmdesk-leader`），聊天编排、记忆、目标                                                                                                                                               |
| **Workers** | 本机 CLI / Registry ACP Agent，经 **ACP**（`@agentclientprotocol/sdk@1.2.1`）执行；builtin 与 custom 仍支持                                                                                            |
| **桌面**    | Electron + React（Vite），双栏默认（全高侧栏 + 主列）+ 按需 Inspector；设置全页四项；UI as-built 规范见 `docs/superpowers/specs/2026-07-16-desktop-as-built-design-system.md`（本地 `design/` 不入库） |

用户在 Session 里用自然语言下任务 → Leader 按 **role** 选 Worker → 调度器入队 Job → ACP 执行（可审批）→ UI 可见进度/结果。

### 1.1 ACP Registry（2026-07-17）

目标：官方 ACP Registry 中全部合法 Agent 可发现/准备/认证/注册/派发（非硬编码三个 preset）。

| 模块                         | 路径                                                            | 职责                                                          |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| 共享类型                     | `packages/shared`                                               | `WorkerSource` / `WorkerReadiness` / public error codes       |
| Catalog 解析 + bundled       | `packages/adapters` `acp-registry*` / `bundled/`                | v2 解析、digest、schema major 门禁                            |
| Installer / auth / probe     | `acp-agent-installer` / `acp-auth` / `acp-capability-probe`     | 安全安装与 readiness                                          |
| Installation / LKG / secrets | `packages/core`                                                 | installations.json、acp-registry.json、worker-secrets.enc     |
| Owner API                    | `packages/mastra-app/src/acp-registry-api.ts`                   | prepare/register/upgrade/secrets/probe 与可取消认证 operation |
| Terminal auth                | `acp-auth-terminal*.ts` + Desktop `WorkerAuthTerminalModal.tsx` | `node-pty`、typed WebSocket、xterm 有界输出与退出后 re-probe  |
| Feature flag                 | `SWARMDESK_AGENT_ACP_TERMINAL_AUTH=0`                           | 关闭 terminal auth；无 shell 回退                             |
| Contract                     | `npm run test:acp-registry-contract`                            | 不 spawn；smoke 需显式 confirm                                |

**新增 on-disk**：`acp-registry.json`、`acp-agent-installations.json`、`agents/<id>/<ver>/<target>/`、`secrets/worker-secrets.enc`

**Scheduler**：readiness gate；force 不能绕过 auth/protocol；Job 保留 `errorCode`。

**风险余量**：Windows/Linux 原生 runner 上的 node-pty ABI 与打包、真实第三方 Agent/CDN E2E、Desktop 人工交互与三平台安装包验收。普通测试不会执行第三方 Agent。

---

## 2. 仓库与架构

```
swarmdesk-agent/
  apps/desktop/               # Electron + React UI
  packages/
    shared/                   # 领域类型（Worker/Job/Session…）
    core/                     # LocalStore、secrets、审批、activity
    adapters/                 # 健康探活、选人、ACP run/list models、OpenCode 隔离
    mastra-app/               # Leader、http-server、scheduler、tools
  docs/HANDOVER.md            # 本文
```

| 运行时     | 端口 / 路径                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------- |
| API + Chat | **`http://127.0.0.1:4111`**（务必用 IPv4；`localhost` 在 macOS 上可能解析到 `::1` 导致 404） |
| Vite 开发  | `http://localhost:5173`                                                                      |
| 启动       | `npm run desktop`（Electron 自启 API + 注入 secrets）或 `npm run dev:mastra`                 |

```
UI (useChat / Jobs / Workers)
    │  REST + SSE chat
    ▼
http-server (mastra-app)          # 主路径；routes/api.ts 为次要/同步副本
    ├─ handleChatStream + Memory + Goals
    ├─ WorkerScheduler.enqueue / cancel（默认 wait=true）
    └─ health / models / detect APIs
         │
         ▼
 adapters: probeWorkerHealth · listAcpModels · runAcpTask
         · prepareOpenCodeAcpEnv · formatWorkerModelError
         │
         ▼
 本机 CLI (claude / codex / opencode acp …)
```

---

## ACP Session 持久恢复（Phase 2）

### Agent capability 处理

| Agent            | 历史手工 probe          | 当前策略                                  |
| ---------------- | ----------------------- | ----------------------------------------- |
| OpenCode         | 曾确认 load/resume      | 每次 initialize 后以 capability 响应为准  |
| Claude Agent ACP | 曾确认 load/resume      | 每次 initialize 后以 capability 响应为准  |
| Codex ACP        | 未作为本轮真实 E2E 结论 | capability 缺失时 fail closed，不猜测支持 |

自动化使用协议级 fake Agent 覆盖 new/resume/load/cancel/close/delete 与失败恢复；真实 CLI 版本会变化，交接时不要把历史 probe 当作永久能力表。

### 复用键

```
Router Session × Worker registration ID × canonical cwd × execution fingerprint
```

execution fingerprint = HMAC(master-derived-key, canonical(command, args, model, execution-relevant-env))

execution-relevant env 固定白名单：全部显式 Worker.env + ambient PATH/HOME/proxy/API keys/agent prefixes/suffixes

### 恢复流程

```
catalog hit?
  no → session/new → persist agentSessionId → prompt
  yes → resume capability?
    yes → session/resume(existing id) → success? → prompt
    no → load capability?
      yes → session/load(existing id) → suppress replay → prompt
      no → recovery_not_supported → fail closed
  resume/load fail → mark stale → fail closed (NEVER session/new)
```

### Catalog

- 文件：`~/.config/swarmdesk-agent/data/acp-sessions.json`（mode 0600，进程锁 + 单写者 lease，原子写入 tmp+fsync+rename）
- 存储：versioned records with keyDigest, agentSessionId, capabilities, state (ready/stale)
- 损坏行为：隔离文件 → unavailable → 全局 fail closed。禁止单 Job reset 或自动重建空 catalog。
- 唯一例外：`ACP_SESSION_REUSE=0` 时完全绕过 catalog read/write

### 生命周期规则

| 事件                  | Live entry               | Catalog                                                        |
| --------------------- | ------------------------ | -------------------------------------------------------------- |
| idle TTL / LRU / 退出 | close                    | 保留                                                           |
| Router Session 删除   | close                    | 事务删除本地映射，成功后启动 remote cleanup；失败则 Store 不删 |
| Project 删除          | 批量 close               | 所有 Session 在一次 catalog mutation 中删除，避免半提交        |
| Worker 执行配置变化   | close / running 进程终止 | 先 purge 该 Worker 旧映射，再更新 Store 配置                   |
| Job cancel            | cancel + close entry     | 视 Agent 响应保留或 stale                                      |
| 用户显式 reset        | close 精确 reuse key     | 事务删除后 best-effort remote delete/close（不自动重跑）       |

远端清理有 deadline，失败只记录脱敏诊断码，不回滚已成功的本地删除，也不进入持久重试队列。

---

## ACP 审批闭环

### WorkerRunEvent 新增

- `approval_requested` — Job 进入待审批状态，携带完整 ApprovalItem
- `approval_resolved` — 审批完成（自动/人工/取消/超时）
- 统一终端谓词：`isTerminalWorkerEvent()` — completed/failed/cancelled/timed_out

### 策略引擎

| 优先级 | ToolKind          | 行为                                              |
| ------ | ----------------- | ------------------------------------------------- |
| 1      | delete            | 始终人工                                          |
| 2      | read/search/think | 优先 allow_once → allow_always fallback           |
| 3      | 其余              | 按 Job 冻结的 Session policy 精确匹配 option.kind |

- 自动路径：一次写入 resolved ApprovalItem，不出现 pending 闪烁
- 人工路径：预注册 waiter → persist pending + Job 状态 + event → await；持久化前置可消除“极快审批丢失 waiter”竞态
- 双 surface 并发：第一个写入胜出，第二个返回 409

### 桌面端

- 唯一卡片投影：`projectWorkerCardPlacements()` 纯函数，message part 优先于 live fallback
- WorkerRunCard：pending_approval 显示 Agent/ToolKind/路径/options/等待时间
- ApprovalActions：Chat 与 RightPanel 共用，按 option.kind 分组 allow/reject
- Composer **访问模式**合一菜单（变更前确认 / 自动编辑 / 计划模式 / 完全访问）→ 同时写 `LeaderMode` + `SessionApprovalPolicy`
- 单条恢复失败：显示错误 + "重新开始该 Agent 上下文" reset action
- catalog 损坏：只显示修复提示，禁止单 Job reset
- `APPROVAL_TIMEOUT_MS` 只接受正数；无效值回退 120s，不会意外立即超时

### Desktop UI v2（2026-07-16）

设计：`docs/superpowers/specs/2026-07-16-desktop-ui-redesign-design.md`  
线稿：`design/gui/wireframe-v2.html`

已落地（前端壳）：

- 双栏默认布局 + 全高侧栏；Inspector **按需**打开（`drawer-w`）
- Design Token v3（`apps/desktop/src/styles.css`）
- 设置 **全页四项**：常规 · 模型设置 · AgentWorker · 关于（入口仅侧栏左下）；AgentWorker 注册通过单一可搜索下拉框选择 ACP Registry Agent，在原卡片内展示来源/信任、异步准备、认证与 readiness；Registry command 只由 Owner materialize，不进入可编辑 custom 表单。
- Composer 悬浮卡片：访问模式、上下文环（估算）、模型+思考、发送/终止红方块
- 空态问候 + 居中 Composer；消息列 max 800px

---

## UI 重构依赖的后端能力缺口（交接清单）

> 下列能力 UI 已按线稿预留或仅客户端估算；**后端尚未支持或未对齐**时请按此扩展。

| 优先级 | 能力                             | 现状                                                    | UI 期望                                                              | 建议 API / 数据模型                                                                                                                                                                           |
| ------ | -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | **上下文占用**                   | 无 token usage 事件；UI 用消息字符/4 粗算               | Composer 左侧 20×20 环；tip：`xx% 已用` + `已用 {used} / 共 {total}` | 聊天 stream / snapshot 附带 `contextUsage: { usedTokens, totalTokens, modelContextWindow }`（Leader 侧即可）；或 `GET /api/sessions/:id/context`                                              |
| **P0** | **per-model 思考强度**           | `CustomProvider.thinkingIntensities` 在**供应商级**     | 线稿：每个 `models[]` 独立 multi-select（含档位列表）                | 扩展 `models[].thinkingIntensities?: ThinkingIntensity[]`；读时 model 优先、缺省回落 provider；settings save 兼容双读迁移                                                                     |
| **P1** | **思考档位 `xhigh`**             | 枚举 `off/low/medium/high/max`；OpenAI map 里 max→xhigh | 线稿 UI 含 **xhigh（极高）** 独立档                                  | `ThinkingIntensity` 增加 `xhigh`；providerOptions 映射表补齐；旧 `max` 保留语义                                                                                                               |
| **P1** | **访问模式 ↔ 审批矩阵**          | UI 映射见 `lib/access-mode.ts`（粗粒度）                | 四项产品语义稳定；delete 仍永远人工                                  | 在 `permission-policy` 固化 ToolKind 矩阵；可选新增 `SessionAccessMode` 字段避免 mode+policy 歧义；**完全访问** vs **自动编辑** 目前同为 `build`+`allow_always`，需后端区分「写操作更宽」策略 |
| **P1** | **上下文窗口简写持久化**         | 数字 token 可存                                         | 输入 `20K`/`128K`/`1M`，规范化后存储                                 | 已有 `contextWindow?: number` 即可；UI `parseContextWindow` 已解析；列表展示可用 `formatContextWindow`                                                                                        |
| **P2** | **会话运行占用环按模型窗口**     | 固定 128k 估算分母                                      | 环分母 = 当前 Leader 模型 `contextWindow`                            | settings/models 已有 per-model ctx 时随 `leaderModel` 下发                                                                                                                                    |
| **P2** | **附件 / Composer「+」**         | 按钮 disabled 占位                                      | 线稿有 +                                                             | 文件/图片附件协议 + 上传路径（未做）                                                                                                                                                          |
| **P2** | **设置页启用开关（供应商）**     | 以 Key 是否配置代替                                     | 头栏「已启用」tag + 可切换开关                                       | `providers[].enabled` 或禁用列表；无 Key 时仍可关                                                                                                                                             |
| **P3** | **去掉永久三栏后的 Jobs 实时性** | Inspector 关闭时 Jobs/审批仍依赖 snapshot 轮询          | 审批主路径在对话 Worker 卡片                                         | 保持 SSE `approval_*` / worker-run；可选 badge 计数到 Inspector 按钮                                                                                                                          |

### 非目标（本 UI 轮次不要求后端）

- 登录 / 账号 / 头像
- ACP 协议变更
- 完整品牌授权图标包

---

## 3. 状态总览

| 状态                   | 含义                           |
| ---------------------- | ------------------------------ |
| ✅ **已完成**          | 已合入代码库，可本地跑通主路径 |
| 🟡 **进行中 / 半完成** | 有实现，但体验或正确性未闭环   |
| ⬜ **待完成**          | 明确缺口，建议下一阶段做       |

---

## 4. ✅ 已完成

### 4.1 基础平台

- [x] Monorepo：`shared` / `core` / `adapters` / `mastra-app` / `apps/desktop`
- [x] Electron 桌面 + Vite 热更新；safeStorage 包装主密钥
- [x] 本地状态：`LocalStore` → `~/.config/swarmdesk-agent/data/state.json`
- [x] i18n（zh/en）+ 主题（system/light/dark）
- [x] Activity 日志 + 右侧动态面板
- [x] Desktop API base 固定 **`127.0.0.1:4111`**（避免 IPv6 404）

### 4.2 设置与模型（Leader 侧 LLM）

- [x] 设置页主从布局：精简 Provider 列表 + 详情（非「堆满注册表」）
- [x] Provider 目录（models.dev 风格）+ 自定义网关
- [x] API Key AES-256-GCM + Electron safeStorage
- [x] Key 别名：`CUSTOM_OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY` 等
- [x] 聊天栏模型选择（仅已配置 Key 的 Provider）
- [x] **思考强度**预设（off / low / medium / high / max）→ `providerOptions`；自定义网关可勾选级别；UI 展示 raw 值
- [x] Provider 图标（Settings / 聊天栏）
- [x] 聊天错误友好化：`formatChatError`（缺 Key / 网络 / 模型），不向用户 dump 原始 stack/JSON

### 4.3 聊天 UX

- [x] Markdown 助手回复；工具默认折叠；思考过程可折叠标签
- [x] Session 历史：`GET /api/memory/messages` + 只发最新一条 + memory thread
- [x] 多 Session 并行：`ChatWorkspace` 保活已打开 session
- [x] 用户消息展示：剥离 inject chrome（`user-message-display`），界面干净

### 4.4 项目 / 会话 / Git / Files

- [x] 打开项目、Session、模式（ask/plan/build/review）
- [x] Git status / Files 有界树
- [x] Goals + Memory status；AgentController
- [x] **Session 延迟命名**（2026-07-19）：新建不再弹窗询问标题，session 用占位标题（`DEFAULT_SESSION_TITLE='New session'`）创建并标记 `titleSource='auto'`；首轮任务完成后 Leader 在 `handleChatStream` 的 `onFinish` 钩子里调用 `generateSessionTitle`（独立无 tools 的 `router-session-titler` Agent，复用 `LEADER_MODEL` + custom providers）→ `store.autoTitleSession` 写入；用户可双击 session 标题或点铅笔按钮触发 `TextPromptModal` 改名，改名后 `titleSource='user'` 锁住、永不被自动覆盖。`POST /api/sessions/:id/rename` 是唯一的主动改名入口。老 snapshot 无 `titleSource` 字段 → 视为 `'auto'`，向后兼容。

### 4.5 Worker 健康与自动侦测

- [x] `probeWorkerHealth`：presence / version / acp_handshake
- [x] 批量健康 + 启动/周期自动探活
- [x] UI：状态徽章、全部检查、详情、深度 ACP 检查
- [x] **自动侦测**本机 ACP CLI（Claude / Codex / OpenCode）：`detectAcpWorkers` + UI「自动侦测」
- [x] 首次引导文案：OpenCode 需选手动模型，避免 _Model is disabled_

### 4.6 Worker 调度（核心）

- [x] **WorkerJob** + **WorkerScheduler**（并发槽、超时、取消 best-effort）
- [x] API：`GET/POST /api/jobs`，`cancel` / `retry`；`POST /api/dispatch` 同步兼容
- [x] Leader 工具：`dispatch-worker` / `get-job` / `list-jobs` / `cancel-job`
- [x] **`dispatch-worker` 默认 `wait=true`**（同一轮拿到 worker 输出）；`wait=false` 仅长后台任务
  - 环境变量 `DISPATCH_MODE=async` 可强制默认异步
  - **不要**把 `dispatch-worker` 放进 Mastra `backgroundTasks`（会提前结束 wait）
- [x] UI Jobs Tab：列表、手动派发、取消/重试、错误高亮

### 4.7 ACP 模型配置（Workers）

- [x] 字段：`model` / `availableModels` / `modelsFetchedAt` / `modelsState`（fresh/stale）/ `modelsError`
- [x] `listAcpModels`：通过 SDK 1.2.1 `configOptions`（稳定 session config option）解析模型列表；不再使用 CLI catalog 或旧 `session.models`
- [x] `runAcpTask` 通过稳定 `session/set_config_option` 设置模型 pin；无效 pin 明确失败，不静默回退
- [x] 模型刷新失败保留旧缓存并设 stale；首次失败返回空列表（无 Zen fallback）
- [x] API：`GET .../models`（含 `stale` 字段）、`POST .../model`
- [x] UI：模型下拉（加载/默认/手动/缓存选项）+ fresh/stale 状态
- [x] OpenCode：real HOME 用于模型 discovery；isolated HOME 仅用于任务执行

**“候选”不等于“已验证可调用”**：ACP `configOptions` 没有提供每个模型的账户余额和实时限流。当前以它作为候选源，再按项目级证据生成短名单：已 pin、Zen/free、已有鉴权证据的直连 Provider；OpenRouter/其余候选仅在搜索时按需返回。每次 prompt 前重新读取鉴权/disabled 证据并精确应用 pin，失败不静默回退。

### 4.8 2026-07-13 重要修复 / 增强

| 主题                        | 说明                                                                                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **availableModels 被冲掉**  | `setWorkerAvailableModels` 后立刻用**旧 worker** `upsertWorker(applyHealthReport)` 覆盖整对象 → 磁盘 `availableModels: null`，但文案仍显示「5 个模型」。**已修**：models API 单次 upsert 带上 models；`upsertWorker` 合并时保留已有 catalog / model。 |
| **Model is disabled 提醒**  | `formatWorkerModelError` → 用户可见 **【模型不可用】** + 引导到 Workers 选模型；Jobs 面板高亮 + `jobs.modelDisabledHint`；OpenCode 未选模型橙色提示条。                                                                                               |
| **Leader 感知 Worker 模型** | `list-workers` 返回 `model` / `modelConfigured` / `availableModels` / `needsModelSelection`；Leader instructions **每轮动态**注入 `summarizeWorkerModels` 快照；失败时要求转述不可用、不编造成功。                                                    |
| **OpenCode ACP 隔离**       | `packages/adapters/src/opencode-acp-env.ts`：临时 HOME、无 `server.port`、默认 Zen（如 `opencode/big-pickle`）、复用 XDG data/cache 鉴权。                                                                                                            |
| **provider slug**           | `opencodego` 等误写归一到 Mastra 可解析 id（`normalizeMastraModelId` / Leader 路径）。                                                                                                                                                                |

### 4.9 Session 复用与 Worker 实时输出 (2026-07-13)

同一 Router Session 连续委派给同一 Worker 时复用 ACP session，Worker 输出实时流到 Leader Chat 并持久化终端结果。

| 组件                        | 说明                                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AcpSessionManager**       | `packages/adapters/src/acp-session-manager.ts` — 复用键 `routerSessionId + workerId + canonicalCwd + fingerprint(HMAC-SHA256)`；FIFO 串行相同键；TTL 15min 空闲回收；LRU 淘汰上限 8；详情见 spec §4-6 |
| **WorkerRunEvent**          | `packages/shared/src/index.ts` — 类型化事件：`started → delta* → completed \| failed \| cancelled`；顺序保证、ANSI 清理                                                                               |
| **dispatchWorkerTool 桥接** | `packages/mastra-app/src/tools/session-tools.ts` — `context.writer.custom('data-worker-run')`；50ms delta 缓冲合并 + 8192 字符 flush；transient delta 不入 Memory，terminal event 持久化              |
| **WorkerRunCard**           | `apps/desktop/src/components/WorkerRunCard.tsx` — Worker 身份标签 + 状态徽章 + 运行时长；running=纯文本 `pre-wrap`，terminal=Markdown；截断提示                                                       |
| **ChatPanel reducer**       | `apps/desktop/src/components/ChatPanel.tsx` `onData` + `apps/desktop/src/lib/worker-run-reducer.ts` — 纯函数按 sequence 追加 delta、忽略重复/乱序、多 Job 独立、历史恢复                              |

**环境变量**：`ACP_SESSION_REUSE=0` 禁用复用（诊断/回滚，包含同键并发）；`ACP_SESSION_IDLE_MS=900000`；`ACP_SESSION_POOL_MAX=8`；`ACP_SESSION_RETRY_MS=250`

**取消/失效生命周期** (spec §6)：取消 → cancel + 2s 等待 → evict；超时 → TERM/KILL → broken → evict；进程退出 → 即删；配置变更 → 旧条目失效、运行中结束后关闭；Session/Project 删除 → 级联关闭

复核补强（2026-07-14）：池满 Job 保持 queued 并重试；终态事件自带 Worker 身份；8192 字符 writer 分片使用唯一 sequence；队列/tool abort listener 会解除；terminal tombstone 与安全 timeout timer 均有界；command、args、model、kind、enabled 和完整显式 env 构成复用失效边界。

### 4.10 Leader 长对话稳定与步骤预算 (2026-07-14)

- [x] Leader 单轮默认 `maxSteps=500`，设置范围 `10..1000`，服务端值覆盖客户端参数。
- [x] 仅在 `steps.length >= maxSteps && finishReason === 'tool-calls'` 时判定预算耗尽。
- [x] 耗尽事件通过 finish metadata 实时送达，并以 `leader-budget:${runId}` 独立 Assistant marker 持久化；避免并发请求误改同 thread 的最后一条回复。
- [x] Chat 显示可恢复提示，可在同一 thread 继续；续跑提示按 zh/en locale 生成。
- [x] `experimental_throttle: 50`、引用稳定 reducer、幂等 details/budget state、仅运行中 Worker 启动 duration tick，用于消除长流同步更新环。
- [ ] Electron 实际长对话压力与预算耗尽手工 E2E 尚待执行；桌面冷启动、鉴权和退出清理已验证，自动化测试与 production build 已通过。

### 4.11 ACP 边界复核加固 (2026-07-15)

- [x] 生产 Manager 仅接受稳定 fingerprint provider + required catalog；HTTP 与 Mastra 组合根共用同一 runtime/Store。
- [x] Catalog 严格 v1 schema、corruption sentinel、copy-on-write + fsync/rename；损坏和 mutation 失败统一脱敏 503。
- [x] new/resume/load 在 prompt 前统一校验并应用 pinned model；新 Session 未成功提交 catalog 时尝试删除远端未提交 Session。
- [x] Session/Worker/reset 使用“live close → catalog commit → async remote cleanup”；Project 的多 Session 映射一次原子删除。
- [x] `dispatchWorkerTool` 仅从 trusted `RequestContext` 取 Router Session/Project/thread，不回退到可变的 global active Session；Mastra 可选 `agent.threadId` 缺失时不会误判 mismatch。
- [x] 人工审批在 pending 可见前先保留 waiter；严格 option kind/ID、CAS resolve、timeout/late-result terminal guard 和完整 audit 字段。
- [x] Scheduler 所有 detached `runJob` rejection 进入可见 failed 终态；无效 `APPROVAL_TIMEOUT_MS` 不再导致立即超时。
- [x] Desktop 用 approval cursor 单调合并 snapshot/实时事件，单 job 只投影一张 Worker 卡片，刷新可恢复 running/pending/reset 标记。
- [x] 根 `npm test` 已收口执行 core/adapters/mastra-app/desktop 全部 `*.test.ts`，避免关键回归“假绿”。
- [x] 2026-07-16 自动验证：全量 1088/1088；typecheck、production build、pnpm frozen lock、`git diff --check` 均通过。

### 4.12 全面复核与桌面启动修复 (2026-07-16)

- [x] Desktop API 使用三类独立 capability token；Electron 只复用同端口、同进程 epoch、同 workspace identity 的已验证实例，settings 由 safeStorage owner 单写。
- [x] `LocalStore`、secrets、ACP catalog 与 runtime owner lease 加入进程锁/原子持久化/失败封闭；跨 checkout 不会误接管或误杀 API。
- [x] ACP 初始化、prompt、cancel、close、远端清理和 one-shot model discovery 的 deadline/Abort/进程组清理补齐；同步 spawn 异常也会回收隔离 HOME。
- [x] Scheduler shutdown admission、orphan reconciliation、capacity retry、审批超时与 terminal persistence 统一为可见终态；writer/HTTP body/NDJSON cursor 均有界。
- [x] Worker 事件在 caller、subscriber、journal 之间深层隔离；Worker 卡片、approval cursor、snapshot hydration 和异步 UI 请求均使用稳定 scope/generation，消除重复卡片与 React update loop。
- [x] `pnpm-workspace.yaml` 恢复完整 workspace 定义并生成可冻结安装的 lockfile。
- [x] 修复生产 Electron 构建：主进程/preload 由 Vite 打包，NodeNext 校验本地 ESM 导入，构建后脚本拒绝源码 workspace import；开发命令与冷启动均实测成功。

### 4.13 工程

- [x] Git + `.gitignore`（node_modules、dist-electron、.env、*.db）
- [x] 单测：health / dispatch / jobs / secrets / thinking / acp-errors / opencode-acp 等

---

## 5. 🟡 进行中 / 半完成（已知缺口）

| 项                                 | 现状                                                                                                                              | 风险                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **ACP 硬取消**                     | 已接通 session/cancel，超时后进程组 TERM/KILL；自动化覆盖父/子进程清理，仍需三种真实 CLI 跨平台验收                               | Agent/平台实现差异可能导致残留进程                                                                        |
| **async Job 完成后 Leader 不知情** | `wait=false` 时需 `get-job`；未自动写 memory / 续跑                                                                               | 假完成 / 重复派发                                                                                         |
| **untilIdle × 后台 Job**           | Chat untilIdle 已开；Job 完成未系统注入续聊                                                                                       | 与 background-tasks 未完全打通                                                                            |
| **ACP 模型可用语义**               | UI/API 已返回证据短名单，并把聚合器长尾放到搜索；prompt 前重验 pin                                                                | ACP 不提供余额/实时限流，不能承诺短名单每次均可调用                                                       |
| **模型缓存状态**                   | `modelsState: 'fresh'                                                                                                             | 'stale'`+`modelsError`                                                                                    | 失败保留旧列表并持久化 stale；首次失败无 fallback |
| **OpenCode 自定义 provider**       | 隔离环境可能拿不到用户禁用的 provider / 付费模型                                                                                  | 需用户 pin Zen 模型或显式开启对应 allow 配置                                                              |
| **routes/api.ts vs http-server**   | Electron **主用 http-server**；两处 API 需同步改                                                                                  | 只改一侧会漏                                                                                              |
| **Mastra Studio chat 上下文**      | Studio 与 HTTP 共用 ACP runtime，但通用 `chatRoute` 不会自行推导 Router Session/Project/thread tuple                              | 未显式注入 trusted `RequestContext` 时，`dispatchWorkerTool` 会按设计 fail closed；Desktop 主路径不受影响 |
| **安装包**                         | electron-builder 已覆盖 macOS arm64 DMG/ZIP、Windows x64 NSIS、Linux x64 AppImage/DEB；macOS 未签名安装包与 packaged smoke 已实测 | 尚未签名/notarize；Windows/Linux 需 GitHub 原生 runner 首次验证                                           |

---

## 6. ⬜ 待完成任务清单（建议优先级）

### P0 — 调度闭环

1. [ ] Job 完成写回 Memory（可选续跑）
2. [ ] Cancel 可靠化真实 CLI / 跨平台验收
3. [x] pending_approval 占槽 UI 提示（Chat/RightPanel 共用真实 options）
4. [ ] E2E 清单：`docs/E2E.md` + 手工 happy path

### P1 — 体验

5. [ ] Job SSE / 统一事件
6. [x] Chat 内 Job 卡片（非大 JSON）
7. [ ] Activity 与 Jobs 时间线统一
8. [x] OpenCode：从 ACP `configOptions` 解析真实模型列表（2026-07-13 SDK 1.2.1 迁移）

### P2 — 模型与 Provider（代码闭环）

> **状态：代码与自动化验证完成。** 跨进程 lease、项目级 catalog、Provider env、pin 事务与 live reuse 证据重验均已落地。剩余项是连接真实账户/CLI 的手工 E2E，不再属于已发现的代码正确性缺陷。

9. [x] Leader 目录与 models.dev 同步策略
   - `RegistrySnapshot` 优先级 + `getLeaderModelCatalog` / `getLeaderFeaturedCatalog`
   - `GET /api/models/catalog?featured=1` 返回 featured ∩ registry + `currentSelection`（`featured` / `not_featured` / `registry_unknown`）
   - Settings 当前模型 chip 标记非精选 / 未登记
   - maintenance：`npm run sync:model-registry -w @swarmdesk-agent/mastra-app`
   - **风险**：真实 models.dev 网络同步与离线 fallback 路径需手工点一次 Settings 确认
10. [x] Worker 模型缓存 TTL；双状态「命令可用 / ACP 会话可用」
    - `modelCatalogState` empty/fresh/stale + catalog store TTL/backoff + SWR（含 `q=`）
    - `commandHealth` / `acpHealth`（兼容 `cliHealth` / `acpSessionHealth`）；legacy health 仅 command
    - Desktop Workers：shortlist 下拉 + `?q=` 搜索 + stale 指示 + cli/acp 徽章
    - Leader `list-workers`：shortlist-only + `modelsState` / `modelCatalogState` / `needsModelSelection` + health 字段
    - **风险**：未做真实 OpenCode 长列表搜索的 UI 手工 E2E
11. [x] 更多网关 env 别名
    - `provider-env-resolver` 覆盖常见 OpenAI-compatible / 自定义网关 env
    - **风险**：私有网关命名仍可能需手工补 alias
12. [x] OpenCode “可用模型”产品策略：pin + Zen/free + 已连接 provider 短列表；OpenRouter 搜索/按需展开
    - eligibility / shortlist vs searchIndex；pin 校验 + 失败 `errorCode` 公共文案（`publicErrorMessage` / `formatPublicError`）
    - pin 独立状态（不污染 availableModels）；空 shortlist 保持空
    - pin 失败 API 返回稳定中文短消息；UI 展示 `error` / `errorCode`；pin 失败回滚 draft
    - **风险**：账户余额/限流仍无法从 ACP catalog 证明「可调用」；手工派发仍需抽查

### P3 — 产品化

13. [x] electron-builder 跨平台未签名安装包；签名/notarize 待后续接入
14. [x] CI：PR/main 全量检查与三平台原生打包 smoke；`v*` 标签聚合发布并生成 SHA256SUMS
15. [x] README 与本文同步本次 ACP 边界
16. [ ] 可选：diff 面板、远程 Worker

---

## 7. 关键文件索引

| 领域                    | 路径                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| 领域类型                | `packages/shared/src/index.ts`                                            |
| 状态存储                | `packages/core/src/store.ts`（`upsertWorker` 合并 catalog）               |
| 密钥                    | `packages/core/src/secure-secrets.ts`                                     |
| 健康探活                | `packages/adapters/src/health.ts`                                         |
| ACP 执行 / 列模型       | `packages/adapters/src/acp-runner.ts`                                     |
| ACP 错误文案            | `packages/adapters/src/acp-errors.ts`                                     |
| OpenCode 隔离           | `packages/adapters/src/opencode-acp-env.ts`                               |
| 自动侦测                | `packages/adapters/src/detect-workers.ts`                                 |
| 调度器                  | `packages/mastra-app/src/scheduler.ts`                                    |
| HTTP API（主）          | `packages/mastra-app/src/http-server.ts`                                  |
| HTTP API（副本）        | `packages/mastra-app/src/routes/api.ts`                                   |
| Leader + tools          | `agents/leader-agent.ts` · `tools/session-tools.ts`                       |
| ACP session pool        | `packages/adapters/src/acp-session-manager.ts`                            |
| ACP session catalog     | `packages/core/src/acp-session-catalog.ts`                                |
| ACP runtime/bootstrap   | `packages/mastra-app/src/acp-runtime.ts` · `acp-runtime-bootstrap.ts`     |
| ACP HTTP/lifecycle 边界 | `packages/mastra-app/src/acp-http-error.ts` · `acp-resource-lifecycle.ts` |
| dispatch Router context | `packages/mastra-app/src/dispatch-context.ts`                             |
| Worker 事件             | `packages/mastra-app/src/worker-events.ts`                                |
| Worker 卡片唯一投影     | `apps/desktop/src/lib/worker-card-placement.ts`                           |
| 聊天错误                | `apps/desktop/src/lib/chat-errors.ts`                                     |
| Worker 卡片             | `apps/desktop/src/components/WorkerRunCard.tsx`                           |
| WorkerRun reducer       | `apps/desktop/src/lib/worker-run-reducer.ts`                              |
| Workers/Jobs UI         | `apps/desktop/src/components/RightPanel.tsx`                              |
| 设置                    | `apps/desktop/src/components/SettingsPanel.tsx`                           |
| i18n                    | `apps/desktop/src/i18n/locales.ts`                                        |

---

## 8. API 速查（当前）

| Method      | Path                                                              | 说明                                                                                              |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| POST        | `/chat/swarmdesk-leader`                                          | AI SDK UI 聊天流                                                                                  |
| GET         | `/api/snapshot`                                                   | 全量状态                                                                                          |
| GET/POST    | `/api/settings`                                                   | 模型 / secrets / thinking / custom providers                                                      |
| GET         | `/api/memory/messages?threadId=&resourceId=`                      | 会话历史                                                                                          |
| POST        | `/api/workers/:id/health`                                         | `depth=presence\|version\|acp`                                                                    |
| POST        | `/api/workers/health`                                             | 批量健康                                                                                          |
| GET         | `/api/workers/registry`                                           | Catalog v2 + LKG/bundled 状态、全分发、平台可用性与 legacy 投影                                   |
| POST        | `/api/workers/registry/prepare`                                   | `202` 创建 Owner 准备 operation                                                                   |
| GET/DELETE  | `/api/workers/registry/operations/:operationId`                   | 查询/取消 prepare 或 Agent-auth operation                                                         |
| POST        | `/api/workers/registry/register`                                  | 从受信 installation 注册；拒绝客户端 command/args/env                                             |
| GET/POST    | `/api/workers/:id/auth-methods` / `/api/workers/:id/authenticate` | 获取认证方法 / `202` 启动 Agent 认证                                                              |
| POST/GET/WS | `/api/workers/:id/auth-terminal[/... ]`                           | 一次性 subprotocol token 的受控 PTY 认证与状态                                                    |
| GET/POST    | `/api/workers/detect`                                             | 预览 / 应用本机 CLI 自动侦测结果                                                                  |
| GET         | `/api/workers/:id/models`                                         | 拉 ACP 短名单（SWR）；`?q=` 搜索 searchIndex；`force=1` 强制刷新；含 `catalogState` / `errorCode` |
| POST        | `/api/workers/:id/model`                                          | 设置 worker 模型 pin（失败返回 `errorCode` + 公共文案）                                           |
| GET         | `/api/models/catalog`                                             | Leader 全量目录；`?featured=1&current=` 精选 ∩ registry + currentSelection                        |
| GET/POST    | `/api/jobs`                                                       | 列表 / 创建                                                                                       |
| POST        | `/api/jobs/:id/cancel` \| `retry`                                 | 取消 / 重试                                                                                       |
| POST        | `/api/jobs/:id/acp-context/reset`                                 | 仅重置 Job 所属精确 ACP reuse key；不接受 `agentSessionId`，不自动重跑                            |
| POST        | `/api/dispatch`                                                   | 兼容同步派发                                                                                      |
| POST        | `/api/sessions/:id/approval-policy`                               | 设置并持久化 Session 级审批策略                                                                   |
| GET/POST    | `/api/approvals*`                                                 | 审批；resolve 必须带真实 `optionId` 和 `surface`                                                  |
| GET         | `/api/git`, `/api/files`                                          | Git / 文件树                                                                                      |
| GET/POST    | `/api/goals`                                                      | 目标                                                                                              |

**环境变量（节选）**

| 变量                                                | 说明                                 |
| --------------------------------------------------- | ------------------------------------ |
| `MASTRA_PORT`                                       | 默认 4111                            |
| `LEADER_MODEL`                                      | Leader 默认模型                      |
| `DISPATCH_MODE=async`                               | 强制 dispatch 默认异步               |
| `WORKER_MAX_*` / `WORKER_JOB_TIMEOUT_MS`            | 调度并发与超时                       |
| `WORKER_MODELS_TIMEOUT_MS`                          | 拉模型超时（默认 ~90s）              |
| `OPENCODE_MODEL`                                    | OpenCode 安全默认（默认 big-pickle） |
| `OPENCODE_ALLOW_GO` / `OPENCODE_ALLOW_CUSTOM_MODEL` | 允许非 Zen 模型进隔离 ACP            |
| `APPROVAL_TIMEOUT_MS`                               | 审批等待                             |
| `WORKER_HEALTH_*`                                   | 自动探活                             |

---

## 9. 本地启动与验证

```bash
npm install
npm test
npm run desktop          # Electron + API 127.0.0.1:4111
# 或
npm run dev:mastra       # 仅 API
npm run dev              # 仅 Vite UI
```

最近一次自动验证（2026-07-17，ACP Registry worktree）：`npm test` 1442/1442；`npm run typecheck`、`npm run build`、API runtime bundle/load、workflow/release contract、无第三方 spawn 的 ACP Registry contract、`git diff --check` 退出码均为 0。PTY shutdown 的 C5 独立复审为 0 Critical / 0 Important / 0 Minor：Owner 会先关闭 terminal-auth 准入，等待活动及已脱离 activity map 的 TERM→KILL，并关闭活动 WebSocket 后再完成 server/runtime drain。macOS arm64 `package:dir` 与 packaged smoke 已真实通过：安装包内部 runtime manifest、bundled Registry、staged libsql/node-pty、PTY load/spawn/write/resize/exit、内部 API health/token 与退出清理均验证，且不借用仓库 `node_modules`。Windows/Linux workflow 与资产契约已自动验证，但真实安装包仍需首次 GitHub 原生 runner 运行确认。Vite 仅提示主 bundle 超过 500 kB，不影响构建成功；本轮没有执行任何真实第三方 Agent。受控延期项为完整 readiness/upgrade actions、observed digest 持久展示和 Registry-specific 小 JSON body cap；真实 CLI 长对话/cancel/审批仍需按下方冒烟清单手工验收。

### 定向测试

```bash
# 策略矩阵
node --import tsx --test packages/core/src/permission-policy.test.ts

# ACP session driver (protocol-level fake Agent)
node --import tsx --test packages/adapters/src/acp-session-driver.test.ts

# Catalog lifecycle
node --import tsx --test packages/core/src/acp-session-catalog.test.ts packages/mastra-app/src/acp-session-lifecycle.test.ts

# Approval events pipeline
node --import tsx --test packages/mastra-app/src/worker-events-core.test.ts packages/mastra-app/src/worker-events.test.ts packages/mastra-app/src/worker-events-e2e-pipeline.test.ts

# Scheduler approval
node --import tsx --test packages/mastra-app/src/scheduler-approval.test.ts

# Worker card placement
node --import tsx --test apps/desktop/src/lib/worker-card-placement.test.ts

# Live ACP recovery (需 ACP_LIVE_TESTS=1)
ACP_LIVE_TESTS=1 node --import tsx --test packages/adapters/src/acp-live.test.ts
```

**冒烟清单（2026-07-13）**

1. 设置页配 Leader Key → 聊天流式回复；错误勿出现原始 stack
2. Workers → **自动侦测** → 启用本机 CLI
3. OpenCode：未选模型时见橙色 **请选择可用模型** 提示
4. 「加载/更新模型列表」→ 下拉只出现项目级证据短名单；搜索可按需查询其余候选；失败保留旧缓存并标 stale
5. 派发 / Leader 委派 OpenCode → 成功；若 disabled → Jobs/Leader 出现 **【模型不可用】**
6. 问 Leader「当前各 worker 用什么模型」→ 应引用 pin / catalog / needsModelSelection
7. 两 session 并行聊天不互相卸载
8. 将 Leader 最大步骤临时设为 10，验证耗尽提示、同线程继续和刷新恢复
9. 长流中连续 dispatch，确认 Worker 卡片实时增长且无 `Maximum update depth exceeded`

**状态文件检查**

```bash
# Worker 行只保存全局兼容视图；实际 UI 以项目级 worker-model catalog 为准
python3 -c "import json;d=json.load(open('$HOME/.config/swarmdesk-agent/data/state.json'));
print([(w['name'], w.get('model'), w.get('modelCatalogState')) for w in d['workers']])"
```

---

## 10. 已知问题与决策记录

| 决策                        | 选择                                                      | 备注                                              |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| API 地址                    | **127.0.0.1** 非 localhost                                | 防 IPv6 404                                       |
| 默认 dispatch wait          | **`wait=true`**                                           | 用户要看到 worker 回复；async 用 env 或显式 false |
| dispatch 与 backgroundTasks | **不**把 dispatch-worker 放 background                    | 否则 wait 被截断                                  |
| 健康语义                    | presence 绿；ACP 模型失败 → **异常**                      | 避免「超时仍可用」                                |
| OpenCode ACP                | 隔离 config + Zen 默认                                    | 用户 `server.port` / disabled model 会炸          |
| OpenCode 列模型             | **ACP `configOptions` (SDK 1.2.1) + real HOME discovery** | 任务执行走隔离 HOME（2026-07-13 迁移）            |
| models API 写库             | **单次 upsert 带 models** + fresh/stale                   | 禁止先 set models 再 health 覆盖                  |
| upsertWorker                | 合并保留 availableModels/model                            | 防健康检查冲掉 catalog                            |
| Model disabled              | 强调 UI + Leader 文案                                     | 用户必须 pin 模型                                 |
| Leader 模型感知             | 动态 instructions + list-workers 字段                     | 每轮刷新 roster                                   |
| 密钥                        | AES + safeStorage                                         | 不入库 git                                        |

**技术债**

- `http-server` 与 `routes/api.ts` 仍为双入口；共享 helper 已覆盖模型和生命周期关键逻辑，但新增 API 仍需同步或进一步收敛。
- Desktop renderer 主 bundle 约 625 kB，可在产品化阶段按 Settings/RightPanel 做动态拆包。
- electron-builder 与 CI/Release 工作流已落地；代码签名、macOS notarization、自定义应用图标，以及真实 Windows/Linux 原生 runner 产物验收尚未完成。
- 真实 Claude/Codex/OpenCode 长对话矩阵尚未落地。
- `npm audit --omit=dev` 报告 AI SDK/Mastra v5 兼容层的低危 `GHSA-866g-f22w-33x8`；上游公告当前明确无 patched version，强制修复会跨 AI SDK 主版本且 Mastra 仍会携带 v5 alias。服务仅绑定 loopback、Desktop API 需 capability token，继续跟踪上游修复后再升级。

---

## 11. 建议下一迭代（1–2 周）

1. **P0-1**：async Job 完成 → memory / 可选续跑
2. **P0-4**：补 `docs/E2E.md`，跑通 OpenCode 模型、Session 复用、预算耗尽与长流压力路径
3. **P0-2**：真实 Claude/OpenCode/Codex CLI 的 cancel/TERM/KILL 进程级验收
4. **P3-13**：接入代码签名、macOS notarization 与自定义应用图标；在首次公开发布前确认 Windows/Linux 原生产物

---

## 12. 近期变更速查（changelog 摘要）

| 日期   | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~07-12 | Jobs 调度、健康探活、Worker model 字段、Settings 精简、思考强度、聊天历史/多 session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 07-13  | API 127.0.0.1；自动侦测 CLI；OpenCode 隔离 ACP；dispatch 默认 wait；模型列表持久化 bugfix；【模型不可用】UX；Leader 动态感知 worker 模型；**SDK 1.2.1 迁移 + fresh/stale 缓存 + cancel>approval 清理 + 文件系统安全**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 07-13  | **Session 复用 (AcpSessionManager)** + Worker 实时流输出 (WorkerRunEvent/WorkerRunCard)；desktop reducer 25 单测                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 07-15  | **ACP boundary hardening**：稳定 fingerprint + 严格原子 catalog + resume/load fail-closed + pinned-model 事务 + 脱敏 503 + remote cleanup；审批 waiter/CAS/timeout 竞态；唯一 Worker 卡片与快照恢复；项目级 catalog 批量原子删除；根 `npm test` 收口全量回归。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 07-16  | **全面复核**：模型证据短名单与项目隔离；process lock/owner lease；Desktop capability auth/safeStorage 单写者；session/cancel/stream/approval/resource cleanup 边界；UI stale async/重复卡片/update loop；pnpm workspace/lockfile；Electron 生产入口打包与真实冷启动修复。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 07-17  | **UI 动画对齐**：motion token 族（--dur-_/--ease-_）+ framer-motion Modal 基座 + Toast 退场 + 流式光标 + useCollapsible（JS Web Animations API height 动画）+ chevron 旋转/交叉淡入 + reduced-motion 全局兜底。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 07-18  | **Chat Supervisor 样式重构**：sup-card header/body/footer 三段结构（元数据下沉 footer）；节点行轻量化（无 card/border/shadow）；专属图标 getToolIcon（不 spin）；WorkerRunCard 从 details→useCollapsible；Markdown em 标题 + accent 色 + en-dash 列表；三主题全适配。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 07-18  | **节点行对齐线稿**（`chat-supervisor-redesign.html`）：① 修复 restyle 引入的 CSS 孤儿声明块（页面垮掉）+ 恢复 worker-logo 品牌色；② 三组件（ThinkingBlock/ToolCallRow/WorkerRunCard）token 统一——图标槽 14px、label fs-xs/text-3、工具展开体改纯文本行+竖线（去终端卡片）；③ Worker 行加 busy-dots + access pill（session 级 resolveAccessMode）+ 旋转 chevron；④ getToolIcon 补 fetch/web→IconGlobe；⑤ sup-model badge 加 IconBolt、footer 加 IconClock/IconBolt、新增 chat.runningShort（无 `●` 前缀）；⑥ Markdown h2/h3 色阶 + blockquote/a/md-pre + stream-cursor 改 accent；⑦ 清理死代码（bubble-md / msg-role-row / msg-run-meta）。**未实现**（数据缺失）：per-worker tok 计数、diff-stat。                                                                                                                                                                                                                                                                                          |
| 07-18  | **dispatchWorkerTool 合并 + 图标重评估**：① 工具行展开时隐藏右侧命令预览（避免与展开体重复）；② dispatchWorkerTool + worker 卡合并为单节点（WorkerRunCard 加 `taskPrompt` prop，展开体 3 段：提示词/审批/回复；默认折叠，运行中自动展开）；③ getToolIcon 重写为 `includes` 语义（适配 PascalCase+Tool 后缀的 router 工具名），新增 IconTrash/IconMove，补全 router 自有工具映射（dispatchWorkerTool→ai-agent、listWorkersTool→workers、getActiveContextTool→info、listProjectsTool→folder、*Job*→clock）；④ CSS .wd-section/.wd-section-label/.wd-prompt-text（次级竖线 guide + mono 提示词）。**未实现**（数据缺失）：worker 展开体的思考过程段、子工具调用历史段——WorkerRunState 无 reasoningText/toolCallHistory 字段。                                                                                                                                                                                                                                                                  |
| 07-18  | **严格对齐线稿 `.node-row` + `.line` 流**（修正上轮自由发挥）：① 三种节点（思考/工具/Worker）的 summary/head 统一恢复线稿 `.node-row` 样式——`padding:4px 8px 4px 1px` + `border-radius:var(--r-md)` + `hover:bg-hover`（之前误改成 padding:0 的纯文本行）；② label 颜色 `--text-3` → `--text-2`（线稿 `.node-label`）；③ Worker + 工具展开体改成线稿 `.node-body-inner .line` 事件流（`<mk>▸/✓/$/✗</mk><tx>...</tx>`），删除自由发挥的 `.wd-section` 分段 + `.tool-row-terminal` 终端块；④ Worker `.line` 映射：task→`▸`、approval→`▸`、error→`✗`、output completed→`✓`+markdown；工具 `.line`：command→`$`、stdout 每行→`▸`、stderr→`✗`、done→`✓`；⑤ 删旧 CSS（wd-section/wd-prompt/wd-output/tool-row-terminal*/worker-card-perm/pre/md/pending/error/truncated/inner）+ i18n key（chat.dispatchPrompt/dispatchReply）。CDP 实测：三者 padding/radius 一致、worker 2 行 .line（▸task + ✓reply 含 markdown）、tool 4 行 .line（$ + 3▸）。                                                  |
| 07-18  | **Worker 空白 + 闪烁 + 输入卡顿三修**（全 CDP 诊断）：① **worker 调用大片空白**——dispatch tool-row 在 message 内、worker-card 走 livePlacements 渲染在末尾（流式中 tool output.jobId 未返回，merge 不生效）→ 中间空白。修复：dispatch running 且无 output 时 `return null` 抑制 tool-row，worker 由 livePlacements 独立承载，tool 返回后 merge 合并节点。CDP 实测最后 leader 无 dispatch tool-row；② **闪烁输入块**——`.msg { animation: msg-enter both }` 常驻所有消息，流式中 assistant id 变化触发 React 重挂载→动画重播=闪烁。修复：改用 CSS `@starting-style` + transition（Chromium 148/Electron 42 支持），只在元素首次插入 DOM 触发一次，后续重渲染不重播。CDP 实测 `.msg` animationName:none；③ **输入框卡顿**——`setInput` 每次按键重渲染整个 ChatPanel（1696 行），messages.map 内 `[...messages].reverse().find()` 每条消息都跑=O(n²)（58²=3364 次），approxTokens reduce 不在 useMemo 里。修复：lastAssistantId 提到 map 外算一次、approxTokens 包 useMemo。CDP 实测验证三修复。 |
| 07-18  | **worker 角色 pill + 流式思考可见 + pending 位置**：① access pill（session 级会随设置变）→ role pill（持久化在 WorkerJob.role，data-role 属性配色：plan=紫/coder=蓝/review=橙/test·research=绿）；② useCollapsible 流式态（keepMounted+open）height 卡 0px（runExpand 的 finished 回调被 streaming 重渲染中断）→ 直接 height:auto；③ msg-pending 从 parts.map 前移到后（始终在最下面）。删除 accessModeId prop/透传/accessCapClass。Token 消耗量暂缓（ACP 有 PromptResponse.usage + usage_update 但都 UNSTABLE，driver 在 acp-session-driver.ts:224 丢弃，需 4 层打通）。                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 07-18  | **输入卡顿根治 · 抽 MessageItem + messageList useMemo**（CDP bench 驱动）：CDP 实测 66 条消息单次按键 22ms（掉帧），98% 是 JS（React render+reconcile）。根因：`setInput` 每次按键重渲染整个 ChatPanel（1700 行），messages.map 重建 66 个 MessageItem element（每个 20 props）+ React reconcile 全部 fiber。修复三层：① 抽 `MessageItem.tsx`（React.memo + 自定义 areEqual，只比较核心数据）；② `registryIdentityFor`/`isMetaOpen` 用 useCallback 稳定化（否则 areEqual 失效）；③ 整个消息列表 JSX（messages.map + livePlacements + budget + error）包进 `useMemo`，deps 全是按键时不变的值 → 返回缓存 JSX → React 跳过整个子树的 element 创建+reconciliation。CDP bench：22ms → 16ms（-27%），messageList useMemo 确认跳过。剩余 16ms 是 ChatPanel body + composerCard（381 行 inline JSX，依赖 input 必须重建）的固定成本——进一步优化需拆 Composer 独立组件（独立阶段）。                                                                                                                |

---

## 13. 联系与资源

- 远程：`git@github.com:xun404/swarmdesk-agent.git`
- Mastra Memory：https://mastra.ai/docs/memory/message-history
- Background tasks：https://mastra.ai/docs/long-running-agents/background-tasks
- OpenCode ACP：https://opencode.ai/docs/acp/
- ACP SDK：`@agentclientprotocol/sdk@1.2.1`（`client` / `buildSession` / `withSession` / `prompt` / `configOptions`）

---

_交接原则：先保证「派活 → 可见 Job → 审批 → 结果可查 → Worker 模型可配可感知」主路径稳定，再做打包与花活。_
