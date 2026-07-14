# Router Agents — 交接文档（Plan & Status）

> **仓库**：https://github.com/xun404/router-agents  
> **默认分支**：`main`
> **本地数据**：`~/.router-agents/`（settings / secrets / state / mastra-memory.db）  
> **文档日期**：2026-07-14

本文档描述：**产品定位、架构、已完成、进行中、待办、风险与本地运维**，供接手同学快速对齐。

---

## 1. 产品是什么

**Router Agents** 是 macOS 桌面「多智能体指挥台」：

| 角色 | 实现 |
|------|------|
| **Leader** | Mastra Agent（`router-leader`），聊天编排、记忆、目标 |
| **Workers** | 本机 CLI：Claude Code / Codex / OpenCode 等，经 **ACP**（`@agentclientprotocol/sdk@1.2.1`）执行 |
| **桌面** | Electron + React（Vite），三栏：项目/会话 · 聊天 · Workers/Jobs/Git/审批 |

用户在 Session 里用自然语言下任务 → Leader 按 **role** 选 Worker → 调度器入队 Job → ACP 执行（可审批）→ UI 可见进度/结果。

---

## 2. 仓库与架构

```
router-agents/
  design/gui/                 # 早期线框/高保真
  apps/desktop/               # Electron + React UI
  packages/
    shared/                   # 领域类型（Worker/Job/Session…）
    core/                     # LocalStore、secrets、审批、activity
    adapters/                 # 健康探活、选人、ACP run/list models、OpenCode 隔离
    mastra-app/               # Leader、http-server、scheduler、tools
  docs/HANDOVER.md            # 本文
```

| 运行时 | 端口 / 路径 |
|--------|-------------|
| API + Chat | **`http://127.0.0.1:4111`**（务必用 IPv4；`localhost` 在 macOS 上可能解析到 `::1` 导致 404） |
| Vite 开发 | `http://localhost:5173` |
| 启动 | `npm run desktop`（Electron 自启 API + 注入 secrets）或 `npm run dev:mastra` |

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

## 3. 状态总览

| 状态 | 含义 |
|------|------|
| ✅ **已完成** | 已合入代码库，可本地跑通主路径 |
| 🟡 **进行中 / 半完成** | 有实现，但体验或正确性未闭环 |
| ⬜ **待完成** | 明确缺口，建议下一阶段做 |

---

## 4. ✅ 已完成

### 4.1 基础平台

- [x] Monorepo：`shared` / `core` / `adapters` / `mastra-app` / `apps/desktop`
- [x] Electron 桌面 + Vite 热更新；safeStorage 包装主密钥
- [x] 本地状态：`LocalStore` → `~/.router-agents/state.json`
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

### 4.5 Worker 健康与自动侦测

- [x] `probeWorkerHealth`：presence / version / acp_handshake
- [x] 批量健康 + 启动/周期自动探活
- [x] UI：状态徽章、全部检查、详情、深度 ACP 检查
- [x] **自动侦测**本机 ACP CLI（Claude / Codex / OpenCode）：`detectAcpWorkers` + UI「自动侦测」
- [x] 首次引导文案：OpenCode 需选手动模型，避免 *Model is disabled*

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

### 4.8 2026-07-13 重要修复 / 增强

| 主题 | 说明 |
|------|------|
| **availableModels 被冲掉** | `setWorkerAvailableModels` 后立刻用**旧 worker** `upsertWorker(applyHealthReport)` 覆盖整对象 → 磁盘 `availableModels: null`，但文案仍显示「5 个模型」。**已修**：models API 单次 upsert 带上 models；`upsertWorker` 合并时保留已有 catalog / model。 |
| **Model is disabled 提醒** | `formatWorkerModelError` → 用户可见 **【模型不可用】** + 引导到 Workers 选模型；Jobs 面板高亮 + `jobs.modelDisabledHint`；OpenCode 未选模型橙色提示条。 |
| **Leader 感知 Worker 模型** | `list-workers` 返回 `model` / `modelConfigured` / `availableModels` / `needsModelSelection`；Leader instructions **每轮动态**注入 `summarizeWorkerModels` 快照；失败时要求转述不可用、不编造成功。 |
| **OpenCode ACP 隔离** | `packages/adapters/src/opencode-acp-env.ts`：临时 HOME、无 `server.port`、默认 Zen（如 `opencode/big-pickle`）、复用 XDG data/cache 鉴权。 |
| **provider slug** | `opencodego` 等误写归一到 Mastra 可解析 id（`normalizeMastraModelId` / Leader 路径）。 |

### 4.9 Session 复用与 Worker 实时输出 (2026-07-13)

同一 Router Session 连续委派给同一 Worker 时复用 ACP session，Worker 输出实时流到 Leader Chat 并持久化终端结果。

| 组件 | 说明 |
|------|------|
| **AcpSessionManager** | `packages/adapters/src/acp-session-manager.ts` — 复用键 `routerSessionId + workerId + canonicalCwd + fingerprint(HMAC-SHA256)`；FIFO 串行相同键；TTL 15min 空闲回收；LRU 淘汰上限 8；详情见 spec §4-6 |
| **WorkerRunEvent** | `packages/shared/src/index.ts` — 类型化事件：`started → delta* → completed \| failed \| cancelled`；顺序保证、ANSI 清理 |
| **dispatchWorkerTool 桥接** | `packages/mastra-app/src/tools/session-tools.ts` — `context.writer.custom('data-worker-run')`；50ms delta 缓冲合并 + 8192 字符 flush；transient delta 不入 Memory，terminal event 持久化 |
| **WorkerRunCard** | `apps/desktop/src/components/WorkerRunCard.tsx` — Worker 身份标签 + 状态徽章 + 运行时长；running=纯文本 `pre-wrap`，terminal=Markdown；截断提示 |
| **ChatPanel reducer** | `apps/desktop/src/components/ChatPanel.tsx` `onData` + `apps/desktop/src/lib/worker-run-reducer.ts` — 纯函数按 sequence 追加 delta、忽略重复/乱序、多 Job 独立、历史恢复 |

**环境变量**：`ACP_SESSION_REUSE=0` 禁用复用（诊断/回滚，包含同键并发）；`ACP_SESSION_IDLE_MS=900000`；`ACP_SESSION_POOL_MAX=8`；`ACP_SESSION_RETRY_MS=250`

**取消/失效生命周期** (spec §6)：取消 → cancel + 2s 等待 → evict；超时 → TERM/KILL → broken → evict；进程退出 → 即删；配置变更 → 旧条目失效、运行中结束后关闭；Session/Project 删除 → 级联关闭

复核补强（2026-07-14）：池满 Job 保持 queued 并重试；终态事件自带 Worker 身份；8192 字符 writer 分片使用唯一 sequence；队列/tool abort listener 会解除；terminal tombstone 与安全 timeout timer 均有界；command、args、model、kind、enabled 和完整显式 env 构成复用失效边界。

### 4.10 Leader 长对话稳定与步骤预算 (2026-07-14)

- [x] Leader 单轮默认 `maxSteps=500`，设置范围 `10..1000`，服务端值覆盖客户端参数。
- [x] 仅在 `steps.length >= maxSteps && finishReason === 'tool-calls'` 时判定预算耗尽。
- [x] 耗尽事件通过 finish metadata 实时送达，并以 `leader-budget:${runId}` 独立 Assistant marker 持久化；避免并发请求误改同 thread 的最后一条回复。
- [x] Chat 显示可恢复提示，可在同一 thread 继续；续跑提示按 zh/en locale 生成。
- [x] `experimental_throttle: 50`、引用稳定 reducer、幂等 details/budget state、仅运行中 Worker 启动 duration tick，用于消除长流同步更新环。
- [ ] Electron 实际长对话压力与预算耗尽手工 E2E 尚待执行；自动化测试与 production build 已通过。

### 4.11 工程

- [x] Git + `.gitignore`（node_modules、dist-electron、.env、*.db）
- [x] 单测：health / dispatch / jobs / secrets / thinking / acp-errors / opencode-acp 等

---

## 5. 🟡 进行中 / 半完成（已知缺口）

| 项 | 现状 | 风险 |
|----|------|------|
| **ACP 硬取消** | 已接通 session/cancel，2 秒后进程组 TERM/KILL；仍需真实 CLI 进程级验收 | 平台差异可能导致残留进程 |
| **async Job 完成后 Leader 不知情** | `wait=false` 时需 `get-job`；未自动写 memory / 续跑 | 假完成 / 重复派发 |
| **untilIdle × 后台 Job** | Chat untilIdle 已开；Job 完成未系统注入续聊 | 与 background-tasks 未完全打通 |
| **多 Session cwd** | Job 绑 project cwd；部分路径仍依赖 `getActive()` | 并发 session 需显式 sessionId |
| **ACP 模型列表体量** | ACP `configOptions`（agent 宣告的可选择模型） | 可能仍较多（数百），这是 agent 宣告结果 |
| **模型缓存状态** | `modelsState: 'fresh' | 'stale'` + `modelsError` | 失败保留旧列表并持久化 stale；首次失败无 fallback |
| **OpenCode 自定义 provider** | 隔离环境可能拿不到用户禁用的 provider / 付费模型 | 需用户 pin Zen 模型或 `OPENCODE_ALLOW_*` |
| **routes/api.ts vs http-server** | Electron **主用 http-server**；两处 API 需同步改 | 只改一侧会漏 |
| **README Phase** | 仍略旧于 Job/模型/侦测能力 | 新人易误判（本文优先） |

---

## 6. ⬜ 待完成任务清单（建议优先级）

### P0 — 调度闭环

1. [ ] Job 完成写回 Memory（可选续跑）
2. [ ] Cancel 可靠化真实 CLI / 跨平台验收
3. [ ] pending_approval 占槽 UI 提示
4. [ ] E2E 清单：`docs/E2E.md` + 手工 happy path

### P1 — 体验

5. [ ] Job SSE / 统一事件
6. [x] Chat 内 Job 卡片（非大 JSON）
7. [ ] Activity 与 Jobs 时间线统一
8. [x] OpenCode：从 ACP `configOptions` 解析真实模型列表（2026-07-13 SDK 1.2.1 迁移）

### P2 — 模型与 Provider

9. [ ] Leader 目录与 models.dev 同步策略
10. [ ] Worker 模型缓存 TTL；双状态「命令可用 / ACP 会话可用」
11. [ ] 更多网关 env 别名

### P3 — 产品化

12. [ ] electron-builder / notarize
13. [ ] CI：`npm test` + typecheck  
14. [ ] README 与本文持续同步
15. [ ] 可选：diff 面板、远程 Worker

---

## 7. 关键文件索引

| 领域 | 路径 |
|------|------|
| 领域类型 | `packages/shared/src/index.ts` |
| 状态存储 | `packages/core/src/store.ts`（`upsertWorker` 合并 catalog） |
| 密钥 | `packages/core/src/secure-secrets.ts` |
| 健康探活 | `packages/adapters/src/health.ts` |
| ACP 执行 / 列模型 | `packages/adapters/src/acp-runner.ts` |
| ACP 错误文案 | `packages/adapters/src/acp-errors.ts` |
| OpenCode 隔离 | `packages/adapters/src/opencode-acp-env.ts` |
| 自动侦测 | `packages/adapters/src/detect-workers.ts` |
| 调度器 | `packages/mastra-app/src/scheduler.ts` |
| HTTP API（主） | `packages/mastra-app/src/http-server.ts` |
| HTTP API（副本） | `packages/mastra-app/src/routes/api.ts` |
| Leader + tools | `agents/leader-agent.ts` · `tools/session-tools.ts` |
| ACP session pool | `packages/adapters/src/acp-session-manager.ts` |
| Worker 事件 | `packages/mastra-app/src/worker-events.ts` |
| 聊天错误 | `apps/desktop/src/lib/chat-errors.ts` |
| Worker 卡片 | `apps/desktop/src/components/WorkerRunCard.tsx` |
| WorkerRun reducer | `apps/desktop/src/lib/worker-run-reducer.ts` |
| Workers/Jobs UI | `apps/desktop/src/components/RightPanel.tsx` |
| 设置 | `apps/desktop/src/components/SettingsPanel.tsx` |
| i18n | `apps/desktop/src/i18n/locales.ts` |

---

## 8. API 速查（当前）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/chat/router-leader` | AI SDK UI 聊天流 |
| GET | `/api/snapshot` | 全量状态 |
| GET/POST | `/api/settings` | 模型 / secrets / thinking / custom providers |
| GET | `/api/memory/messages?threadId=&resourceId=` | 会话历史 |
| POST | `/api/workers/:id/health` | `depth=presence\|version\|acp` |
| POST | `/api/workers/health` | 批量健康 |
| POST | `/api/workers/detect` | 自动侦测本机 CLI（若已实现路径名以代码为准） |
| GET | `/api/workers/:id/models` | 拉 ACP 模型 + 更新 health + **持久化 availableModels** |
| POST | `/api/workers/:id/model` | 设置 worker 模型 pin |
| GET/POST | `/api/jobs` | 列表 / 创建 |
| POST | `/api/jobs/:id/cancel` \| `retry` | 取消 / 重试 |
| POST | `/api/dispatch` | 兼容同步派发 |
| GET/POST | `/api/approvals*` | 审批 |
| GET | `/api/git`, `/api/files` | Git / 文件树 |
| GET/POST | `/api/goals` | 目标 |

**环境变量（节选）**

| 变量 | 说明 |
|------|------|
| `MASTRA_PORT` | 默认 4111 |
| `LEADER_MODEL` | Leader 默认模型 |
| `DISPATCH_MODE=async` | 强制 dispatch 默认异步 |
| `WORKER_MAX_*` / `WORKER_JOB_TIMEOUT_MS` | 调度并发与超时 |
| `WORKER_MODELS_TIMEOUT_MS` | 拉模型超时（默认 ~90s） |
| `OPENCODE_MODEL` | OpenCode 安全默认（默认 big-pickle） |
| `OPENCODE_ALLOW_GO` / `OPENCODE_ALLOW_CUSTOM_MODEL` | 允许非 Zen 模型进隔离 ACP |
| `APPROVAL_TIMEOUT_MS` | 审批等待 |
| `WORKER_HEALTH_*` | 自动探活 |

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

**冒烟清单（2026-07-13）**

1. 设置页配 Leader Key → 聊天流式回复；错误勿出现原始 stack
2. Workers → **自动侦测** → 启用本机 CLI
3. OpenCode：未选模型时见橙色 **请选择可用模型** 提示
4. 「加载/更新模型列表」→ 下拉只出现 ACP `configOptions` 宣告项；失败保留旧缓存并标 stale
5. 派发 / Leader 委派 OpenCode → 成功；若 disabled → Jobs/Leader 出现 **【模型不可用】**
6. 问 Leader「当前各 worker 用什么模型」→ 应引用 pin / catalog / needsModelSelection
7. 两 session 并行聊天不互相卸载
8. 将 Leader 最大步骤临时设为 10，验证耗尽提示、同线程继续和刷新恢复
9. 长流中连续 dispatch，确认 Worker 卡片实时增长且无 `Maximum update depth exceeded`

**状态文件检查**

```bash
# OpenCode 应有 availableModels 数组，而非 null
python3 -c "import json;d=json.load(open('$HOME/.router-agents/state.json'));
print([(w['name'], w.get('model'), len(w.get('availableModels') or [])) for w in d['workers']])"
```

---

## 10. 已知问题与决策记录

| 决策 | 选择 | 备注 |
|------|------|------|
| API 地址 | **127.0.0.1** 非 localhost | 防 IPv6 404 |
| 默认 dispatch wait | **`wait=true`** | 用户要看到 worker 回复；async 用 env 或显式 false |
| dispatch 与 backgroundTasks | **不**把 dispatch-worker 放 background | 否则 wait 被截断 |
| 健康语义 | presence 绿；ACP 模型失败 → **异常** | 避免「超时仍可用」 |
| OpenCode ACP | 隔离 config + Zen 默认 | 用户 `server.port` / disabled model 会炸 |
| OpenCode 列模型 | **ACP `configOptions` (SDK 1.2.1) + real HOME discovery** | 任务执行走隔离 HOME（2026-07-13 迁移） |
| models API 写库 | **单次 upsert 带 models** + fresh/stale | 禁止先 set models 再 health 覆盖 |
| upsertWorker | 合并保留 availableModels/model | 防健康检查冲掉 catalog |
| Model disabled | 强调 UI + Leader 文案 | 用户必须 pin 模型 |
| Leader 模型感知 | 动态 instructions + list-workers 字段 | 每轮刷新 roster |
| 密钥 | AES + safeStorage | 不入库 git |

**技术债**

- OpenCode 真实模型目录已改为 ACP `configOptions` 解析（2026-07-13）
- `http-server` 与 `routes/api.ts` 双轨同步（2026-07-13 已收敛到 `refreshWorkerModels` helper）
- README Phase 章节可再对齐本文
- Codex ACP bridge 尚未升级为 SDK 1.2.1（本次不涉及）

---

## 11. 建议下一迭代（1–2 周）

1. **P0-1**：async Job 完成 → memory / 可选续跑
2. **P0-4**：补 `docs/E2E.md`，跑通 OpenCode 模型、Session 复用、预算耗尽与长流压力路径
3. **P0-2**：真实 Claude/OpenCode/Codex CLI 的 cancel/TERM/KILL 进程级验收
4. **P3-13/14**：CI + README 同步

---

## 12. 近期变更速查（changelog 摘要）

| 日期 | 内容 |
|------|------|
| ~07-12 | Jobs 调度、健康探活、Worker model 字段、Settings 精简、思考强度、聊天历史/多 session |
| 07-13 | API 127.0.0.1；自动侦测 CLI；OpenCode 隔离 ACP；dispatch 默认 wait；模型列表持久化 bugfix；【模型不可用】UX；Leader 动态感知 worker 模型；**SDK 1.2.1 迁移 + fresh/stale 缓存 + cancel>approval 清理 + 文件系统安全** |
| 07-13 | **Session 复用 (AcpSessionManager)** + Worker 实时流输出 (WorkerRunEvent/WorkerRunCard)；desktop reducer 25 单测 |

---

## 13. 联系与资源

- 远程：`git@github.com:xun404/router-agents.git`  
- Mastra Memory：https://mastra.ai/docs/memory/message-history  
- Background tasks：https://mastra.ai/docs/long-running-agents/background-tasks  
- OpenCode ACP：https://opencode.ai/docs/acp/
- ACP SDK：`@agentclientprotocol/sdk@1.2.1`（`client` / `buildSession` / `withSession` / `prompt` / `configOptions`）

---

*交接原则：先保证「派活 → 可见 Job → 审批 → 结果可查 → Worker 模型可配可感知」主路径稳定，再做打包与花活。*
)
