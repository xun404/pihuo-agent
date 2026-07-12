# Router Agents — 交接文档（Plan & Status）

> **仓库**：https://github.com/xun404/router-agents  
> **默认分支**：`main`（`8937ed5` 及后续本地改动需确认是否已 push）  
> **本地数据**：`~/.router-agents/`（settings / secrets / state / mastra-memory.db）  
> **文档日期**：2026-07-12  

本文档描述：**产品定位、架构、已完成、进行中、待办、风险与本地运维**，供接手同学快速对齐。

---

## 1. 产品是什么

**Router Agents** 是 macOS 桌面「多智能体指挥台」：

| 角色 | 实现 |
|------|------|
| **Leader** | Mastra Agent（`router-leader`），聊天编排、记忆、目标 |
| **Workers** | 本机 CLI：Claude Code / Codex / OpenCode 等，经 **ACP**（`@mastra/acp`）执行 |
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
    adapters/                 # 健康探活、选人、ACP run/list models
    mastra-app/               # Leader、http-server、scheduler、tools
  docs/HANDOVER.md            # 本文
```

| 运行时 | 端口 / 路径 |
|--------|-------------|
| API + Chat | `http://127.0.0.1:4111`（`POST /chat/router-leader`，`/api/*`） |
| Vite 开发 | `http://localhost:5173` |
| 启动 | `npm run desktop`（Electron 自启 API + 注入 secrets） |

```
UI (useChat / Jobs / Workers)
    │  REST + SSE chat
    ▼
http-server (mastra-app)
    ├─ handleChatStream + Memory + Goals
    ├─ WorkerScheduler.enqueue / cancel
    └─ health / models APIs
         │
         ▼
adapters: probeWorkerHealth · listAcpModels · runAcpTask
         │
         ▼
本机 CLI (npx claude-acp / codex-acp / opencode acp)
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
- [x] 本地状态：`LocalStore` → `~/.router-agents/state.json`（projects / sessions / workers / approvals / jobs）
- [x] i18n（zh/en）+ 主题（system/light/dark）
- [x] Activity 日志 + 右侧动态面板

### 4.2 设置与模型（Leader 侧 LLM）

- [x] 设置页：Provider 目录（models.dev 风格）、API Key 加密存储
- [x] 自定义 Provider（baseURL / apiStyle / 模型 id；env 名自动生成）
- [x] Key 别名：`CUSTOM_OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY` 等（`applyMastraProviderKeyAliases`）
- [x] 聊天栏模型选择（仅展示已配置 Key 的 Provider）
- [x] **思考强度** `thinkingIntensity`（off→max）→ `providerOptions`（OpenAI / Anthropic / Google…）
- [x] 设置与聊天栏同步思考强度

### 4.3 聊天 UX

- [x] Markdown 渲染助手回复（`react-markdown` + GFM）
- [x] 工具调用默认折叠；思考过程 streaming 展开、结束后折叠
- [x] 视觉弱化边框（减少卡片割裂感）
- [x] **Session 历史**：`GET /api/memory/messages` + `memory.recall` + `toAISdkV5Messages`
- [x] 发消息只送最新一条 + memory thread/resource（符合 Mastra Memory 建议）
- [x] **多 Session 并行**：`ChatWorkspace` 保活已打开 session，切换不卸载流
- [x] 侧栏 busy 点：session 正在 streaming 时显示

### 4.4 项目 / 会话 / Git / Files

- [x] 打开项目（webkitdirectory + `getPathForFile` 等兼容路径）
- [x] Session 创建 / 激活 / 模式（ask/plan/build/review）
- [x] Git status 真实命令；Files 有界目录树
- [x] Goals + Memory status API；AgentController 状态接口

### 4.5 Worker 健康（调度前置）

- [x] `probeWorkerHealth`：presence / version / acp_handshake
- [x] 结构化 `WorkerHealthReport`（message / hints / latency）
- [x] 单测 + 批量 `POST /api/workers/health`
- [x] 启动/周期自动探活（`scheduleAutoWorkerHealth`）
- [x] UI：状态徽章、全部检查、详情展开
- [x] 选人 preferHealthy；dispatch 失败信息带健康原因

### 4.6 Worker 调度（核心）

- [x] **WorkerJob** 模型 + store CRUD（最近 100 条）
- [x] **WorkerScheduler**：入队、并发槽（全局 2 / worker 1 / session 2）、超时、取消（best-effort abort）
- [x] 调度前 stale health 刷新 + fallback 候选
- [x] API：`GET/POST /api/jobs`，`cancel` / `retry`；旧 `POST /api/dispatch` → wait=true
- [x] Leader 工具：`dispatch-worker`（默认 async 返回 jobId）、`get-job`、`list-jobs`、`cancel-job`
- [x] UI **Jobs** Tab：列表、手动派发、取消/重试、output 展开
- [x] Workers 显示 **忙碌**；session status 由 open jobs + approvals 推导
- [x] Background tasks：Mastra 上启用；`dispatchWorkerTool` 可后台

### 4.7 ACP 模型配置

- [x] Worker 字段：`model` / `availableModels` / `modelsFetchedAt`
- [x] `listAcpModels` → `AcpAgent.getAvailableModels()`
- [x] `runAcpTask` / scheduler 透传 `model` → `createACPTool({ model })`
- [x] API：`GET .../models`、`POST .../model`
- [x] UI：单一模型下拉（加载列表 / 默认 / 手动输入 / 缓存选项）
- [x] 拉模型失败时健康改为 **异常**（不再假「可用」）；成功则标 ACP 可用

### 4.8 工程与仓库

- [x] Git 初始化 + 首提交推送 `origin/main`
- [x] `.gitignore`：node_modules、dist-electron、.env、*.db 等
- [x] 核心单测：health / dispatch select / jobs store / secrets / thinking intensity 等

---

## 5. 🟡 进行中 / 半完成（已知缺口）

| 项 | 现状 | 风险 |
|----|------|------|
| **ACP 硬取消** | `AbortController` 标记 cancelled，子进程未必杀干净 | 僵尸 CLI / 占槽位 |
| **async Job 完成后 Leader 不知情** | 需 `get-job` 轮询；未自动写回 memory / re-invoke | 用户/Leader 易「假完成」或重复派发 |
| **untilIdle × 后台 Job** | Chat 开了 untilIdle；Job 完成未系统注入续聊 | 与 background-tasks 文档能力未打通 |
| **多 Session cwd 隔离** | Job 绑 project cwd；active 上下文偶发依赖 `getActive()` | 切 session 时 API 手动派发需显式 sessionId（Jobs UI 已传） |
| **模型列表拉取** | npx 冷启动易慢/超时；90s 超时 + 失败改 unhealthy | 首次体验差，需文档/缓存策略 |
| **dist-electron 未提交** | 正确（构建产物）；首次 clone 需 `npm i` + desktop | — |
| **README Phase 描述** | 落后于实际能力 | 新人易误判进度 |
| **routes/api.ts vs http-server** | 双轨：Electron 主用 http-server；mastra dev 可能走 routes | 两处需同步改 API |

---

## 6. ⬜ 待完成任务清单（建议优先级）

### P0 — 调度闭环可靠性

1. [ ] **Job 完成写回 Memory**（thread 注入摘要），可选触发 Leader 续跑 / untilIdle  
2. [ ] **Cancel 可靠化**：进程组 kill / `@mastra/acp` signal 支持验证  
3. [ ] **Job 超时与 pending_approval 占槽**文档化 + UI 提示「等待审批占用 worker」  
4. [ ] **E2E 手工/脚本**：happy path、审批、missing worker、双 session 并行、cancel  

### P1 — 体验与可观测

5. [ ] Job SSE / 轮询统一（UI 已 2.5s poll；可加 API events）  
6. [ ] Chat 中工具结果渲染 **Job 卡片**（非大 JSON）  
7. [ ] Activity 与 Jobs 状态统一时间线  
8. [ ] 打开项目路径：macOS 无框窗口/空 selection 边界再验证  

### P2 — 模型与 Provider

9. [ ] Leader 模型目录与 models.dev 自动同步策略  
10. [ ] Worker 模型列表缓存 TTL、失败不误伤「仅 presence 健康」的展示文案（已区分 acp 失败→unhealthy，可再拆「命令可用 / ACP 会话可用」双状态）  
11. [ ] 自定义 Provider 与 opencode-go 等网关更多 env 别名表  

### P3 — 产品化

12. [ ] 打包分发（electron-builder / notarize）  
13. [ ] CI：`npm test` + typecheck  
14. [ ] 更新 README 与本文档同步  
15. [ ] 可选：Job 结果 diff 面板、远程 Worker  

---

## 7. 关键文件索引（接手必读）

| 领域 | 路径 |
|------|------|
| 领域类型 | `packages/shared/src/index.ts` |
| 状态存储 | `packages/core/src/store.ts` |
| 密钥 | `packages/core/src/secure-secrets.ts` |
| 健康探活 | `packages/adapters/src/health.ts` |
| ACP 执行 / 模型列表 | `packages/adapters/src/acp-runner.ts` |
| 选人 / 委派纯逻辑 | `packages/adapters/src/select-worker.ts`, `dispatch.ts` |
| 调度器 | `packages/mastra-app/src/scheduler.ts` |
| HTTP API | `packages/mastra-app/src/http-server.ts` |
| Leader + tools | `packages/mastra-app/src/agents/leader-agent.ts`, `tools/session-tools.ts` |
| 聊天 | `apps/desktop/src/components/ChatPanel.tsx`, `ChatWorkspace.tsx` |
| Workers/Jobs UI | `apps/desktop/src/components/RightPanel.tsx` |
| 设置 | `apps/desktop/src/components/SettingsPanel.tsx` |

---

## 8. API 速查（当前）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/chat/router-leader` | AI SDK UI 聊天流 |
| GET | `/api/snapshot` | 全量状态 |
| GET/POST | `/api/settings` | 模型 / secrets / custom providers |
| GET | `/api/memory/messages?threadId=&resourceId=` | 会话历史 UI 消息 |
| POST | `/api/workers/:id/health` | 健康检查 `depth` |
| POST | `/api/workers/health` | 批量健康 |
| GET | `/api/workers/:id/models` | ACP 模型列表（更新 health） |
| POST | `/api/workers/:id/model` | 设置 worker 模型 |
| GET/POST | `/api/jobs` | 列表 / 创建 Job |
| POST | `/api/jobs/:id/cancel` \| `retry` | 取消 / 重试 |
| POST | `/api/dispatch` | 兼容同步派发 |
| GET/POST | `/api/approvals*` | 审批队列 |
| GET | `/api/git`, `/api/files` | 项目 Git / 文件树 |
| GET/POST | `/api/goals` | 目标 |

环境变量（节选）：`MASTRA_PORT`、`WORKER_MAX_*`、`WORKER_JOB_TIMEOUT_MS`、`WORKER_MODELS_TIMEOUT_MS`、`DISPATCH_MODE=sync`、`APPROVAL_TIMEOUT_MS`、`WORKER_HEALTH_*`。

---

## 9. 本地启动与验证

```bash
npm install
npm test                          # monorepo 单测
npm run desktop                   # Electron + API :4111
# 或
npm run dev:mastra                # 仅 API
```

**冒烟建议**

1. 设置页配置 Leader 模型 Key → 聊天能流式回复  
2. 刷新页面 → 同一 session 历史仍在  
3. Workers → 健康检查 / 模型下拉「加载列表」→ 成功则可用，失败则异常  
4. Jobs → 派发 role=coder → 列表出现 running → 审批如有 → succeeded  
5. 两 session 各开聊 → 互不卸载  

---

## 10. 已知问题与决策记录

| 决策 | 选择 | 备注 |
|------|------|------|
| 默认 dispatch | **async** jobId | `wait=true` 可同步 |
| 健康语义 | presence 绿；ACP 模型失败 → **异常** | 避免「超时仍可用」 |
| 模型 UI | 单一下拉含加载/默认/手输 | 无独立「从 ACP 拉取」按钮 |
| 密钥 | AES + Electron safeStorage | 不入库 git |
| Chat 历史 | Mastra Memory + 只发最新消息 | 见 models.dev / Mastra docs |
| 多 session | 多 ChatPanel 挂载隐藏 | 内存换并行 |

**已知 UX/技术债**

- Open project：frameless 下原生对话框曾 empty_selection；现主路径 webkitdirectory  
- ACP 模型列表对 npx 冷启动慢  
- Cancel 不保证杀进程  
- README Phase 章节未更新到 Job 调度与模型配置  

---

## 11. 建议下一迭代（1–2 周）

1. **P0-1 + P0-2**：Job 完成 → memory 注入 + cancel 进程清理  
2. **P0-4**：写一份 `docs/E2E.md` 手工清单并跑通  
3. **P1-6**：Chat Job 卡片  
4. **P3-13/14**：CI + 刷新 README / 本交接文档勾选  

---

## 12. 联系与资源

- 远程：`git@github.com:xun404/router-agents.git`  
- Mastra Memory：https://mastra.ai/docs/memory/message-history  
- Background tasks：https://mastra.ai/docs/long-running-agents/background-tasks  
- ACP 模型：`@mastra/acp` README（`model` / `getAvailableModels`）  

---

*交接原则：先保证「派活 → 可见 Job → 审批 → 结果可查」主路径稳定，再做打包与花活。*
