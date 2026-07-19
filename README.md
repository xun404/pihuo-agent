# Router Agents

Mac 桌面「多智能体指挥台」：用 **Mastra Supervisor** 做 Leader，协调 **Claude Code / Codex / OpenCode** 等 CLI（ACP）Worker。

> **完整进度 / 已知问题 / 运维交接**：见 [`docs/HANDOVER.md`](./docs/HANDOVER.md)（以交接文档为准，更新于 2026-07-16）。

## 下载与安装

发布版本可从 [GitHub Releases](https://github.com/xun404/router-agents/releases) 下载。当前发布矩阵：

| 系统    | 架构                   | 安装包        |
| ------- | ---------------------- | ------------- |
| macOS   | Apple Silicon（arm64） | DMG、ZIP      |
| Windows | x64                    | NSIS EXE      |
| Linux   | x64                    | AppImage、DEB |

当前安装包尚未进行代码签名或 macOS notarization。macOS Gatekeeper 或
Windows SmartScreen 可能显示来源未知警告；请先核对同一 Release 中的
`SHA256SUMS`，并只从本仓库 Releases 下载。

```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS

# Windows PowerShell（将文件名替换为实际下载的安装包）
Get-FileHash .\Router-Agents-0.1.0-win-x64.exe -Algorithm SHA256
```

桌面安装包包含 Router Agents UI 与本地 API runtime，但不内置 ACP Agent
CLI。使用对应 Worker 前，仍需按该 Agent 的说明安装并登录其 CLI。

## Phase 状态

### Phase 0（完成）

- Monorepo 骨架：`packages/*` + `apps/desktop`
- 本地状态存储（Project / Session / Worker）
- Mastra Leader Agent + REST API + Chat 流式路由
- Desktop 三栏 UI + Electron 主进程（自启并校验本仓库 API，安全 preload）
- **i18n**：中文 / English（标题栏切换，偏好可落盘）
- **Worker 角色**：`plan` · `coder` · `review` · `test` · `research` · `general`

### Phase 1（完成）

- **ACP 委派路径**：`dispatchToWorker` + `@agentclientprotocol/sdk@1.2.1`（`packages/adapters`）
- CLI 不可用时返回 **`ok: false` + `mode: planned_unavailable`**（非静默成功）
- **审批队列**：`ApprovalItem` + `GET/POST /api/approvals` + `POST /api/approvals/:id/resolve`
- ACP `onPermissionRequest` → **等待** UI/API resolve（`waitForApprovalDecision`，可配置 `APPROVAL_TIMEOUT_MS`）
- 角色选择仍驱动委派（unit tests 覆盖）

### Phase 2（完成）

- **Leader 步骤预算**：默认 500 步，范围 10-1000，"运行"设置页可配置。耗尽时 Chat 显示"继续"按钮复用当前 thread。
- **长流稳定性**：`experimental_throttle: 50`、worker reducer 引用稳定性、250ms tick 条件启动。
- **ACP Session 持久恢复**：复用边界为 `Router Session × Worker × canonical cwd × execution fingerprint`。跨 TTL/断线/重启保留 Agent 上下文；`resume` 优先、仅在不支持 resume 时使用 `load`，失败绝不静默 `session/new`。
- **Catalog fail closed**：`~/.config/router-agents/data/acp-sessions.json` 严格校验且原子写入；损坏/持久化失败时停止新 ACP 会话，API 返回脱敏 503，不会退化为空上下文。
- **实时审批闭环**：ACP 权限请求实时进入对应 Worker 卡片；Chat/RightPanel 共用真实 options；五种 Session 级自动审批策略（手动/允许一次/始终允许/拒绝一次/始终拒绝）。
- **唯一卡片投影**：同一 jobId 运行/审批/终态始终只渲染一张 Worker 卡片。

### 真实路径（Git / Files / 注册，完成）

- **Git**：`GET /api/git` · `GET /api/projects/:id/git` — 真实 `git status --porcelain` + numstat；非仓库返回结构化错误
- **Files**：`GET /api/files` · `GET /api/projects/:id/files` — 真实目录树（有界深度）
- **打开项目**：`POST /api/projects` + UI「打开项目…」（按本地绝对路径）
- **注册 Worker（Registry）**：设置 → AgentWorker → 可搜索下拉框选择 ACP Registry Agent → Owner `prepare`（下载/materialize）→ 信任确认（无 sha 需显式确认）→ 认证（agent / terminal / env_var）→ readiness `ready` 后可派发。手工 custom 仍用 `POST /api/workers`。
- **Registry 离线**：`~/.config/router-agents/data/acp-registry.json` LKG + 安装包内 bundled snapshot；schema 只随软件升级，不热更新。
- **本机进程模型**：Registry Agent 以当前 OS 用户权限运行，非强沙箱；安装与认证均需用户显式触发。
- **Seed Demo**：仅可选调试辅助，不是主路径
- **默认单端口**：`http-server` 同时提供 REST + `POST /chat/router-leader`（桌面 `useChat` 同源，不再 404）
- **Shared LocalStore**：HTTP 与 Leader tools 共用 `getSharedStore()`
- **Activity**：`GET /api/activity` 实时事件流（项目/审批/委派/chat）
- **设置页**：标题栏 ⚙ — API Keys + Leader 模型（Mastra `provider/model`）
- **运行设置**：Leader 最大步骤数（10-1000，默认 500）
- **自动审批 chip**：Composer 顺序 [模式] [模型] [思考] [自动审批]，独立于运行中 Job
- **安全存储**：AES-256-GCM 于 `~/.config/router-agents/secrets.enc`；主密钥由本机账户标识派生（不写入磁盘、不访问系统钥匙串）

```bash
npm test                 # 全部 core / adapters / mastra-app / desktop 回归测试（最近 1487/1487）
npm run dev:mastra       # 默认 API+Chat :4111
npm run desktop          # Electron（自启 API+Chat + 安全存储）
# 或在设置页填写 OPENAI_API_KEY / ANTHROPIC_API_KEY 等，无需手写 .env
```

### Worker 默认角色

| Worker      | 主角色 primaryRole | 可兼角色 roles                 |
| ----------- | ------------------ | ------------------------------ |
| Claude Code | coder              | coder, plan, research, general |
| Codex CLI   | review             | review, coder, test, general   |
| OpenCode    | general            | general, coder, plan, test     |

Leader 委派时优先按 **role** 选人，再落到具体 CLI。右侧 Workers 面板可点主角色循环、展开勾选 roles。

> OpenCode 以 ACP `configOptions` 为候选源，但默认只返回项目级可用短名单：已 pin、Zen/free 与有鉴权证据的直连 Provider；OpenRouter/其余候选仅在搜索时按需返回。账户余额和实时限流无法由 catalog 证明，prompt 前仍会重新校验并精确应用 pin；失败时不静默换模型。

## 仓库结构

```
router-agents/
  apps/desktop/         # React GUI (+ Electron 入口)
  packages/
    shared/             # 领域类型
    core/               # LocalStore
    adapters/           # CLI 预设 + 健康检查
    mastra-app/         # Leader + API + chatRoute
```

## 快速开始

### 1. 安装

```bash
npm install
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY（或其它 Provider）
```

### 2. 启动 API（终端 1）

```bash
npm run dev:mastra
```

默认：`http://127.0.0.1:4111`（`packages/mastra-app` 的 `http-server`：snapshot / workers / approvals / dispatch）

### 3. 启动 Desktop UI（终端 2）

```bash
npm run dev
```

浏览器打开：`http://localhost:5173`

1. 点 **Seed Demo** 创建示例 Project/Session
2. 在 Chat 里描述任务（需配置当前 Leader 模型对应的 API Key）
3. `POST /api/dispatch` 在 CLI 未装齐时返回 `planned_unavailable`

### 4. 测试

```bash
npm test
```

### 5. 从源码构建桌面安装包

需要 Node.js 22.13+。安装锁定依赖并构建当前平台：

```bash
npm ci
npm run package:prepare
npm run package:dir       # 当前平台未压缩应用
npm run smoke:packaged    # 验证打包后的内部 API
npm run test:acp-registry-contract  # 解析 bundled/remote Registry（不 spawn Agent）
# 第三方 Agent 真机 smoke 必须显式确认，默认拒绝：
# npm run smoke:acp-registry -- --agents <id> --confirm-third-party-execution
```

原生安装包命令：

```bash
npm run package:mac       # 仅 macOS arm64
npm run package:win       # 仅 Windows x64
npm run package:linux     # 仅 Linux x64
```

跨平台发布由 GitHub Actions 在各平台原生 runner 上构建；`v*` 标签必须与
根目录及 Desktop 的 package version 完全一致，例如 `v0.1.0`。

## 环境变量

| 变量                                           | 说明                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                               | Leader 默认 `openai/gpt-5.5`                                                          |
| `LEADER_MODEL`                                 | 覆盖模型，如 `anthropic/claude-sonnet-4-6`                                            |
| `MASTRA_PORT`                                  | 默认 `4111`；只接受 `1..65535` 的整数，无效值回退默认端口                             |
| `VITE_MASTRA_URL`                              | Desktop 连接的 API，默认 `http://127.0.0.1:4111`（优先 IPv4，避免 localhost→::1 404） |
| `ACP_SESSION_REUSE`                            | `0` 时禁用持久复用（诊断/回滚）；其他值启用严格 catalog                               |
| `ACP_SESSION_IDLE_MS` / `ACP_SESSION_POOL_MAX` | Live ACP 连接空闲 TTL / 池上限；回收 live 连接不删持久 context                        |
| `APPROVAL_TIMEOUT_MS`                          | 人工审批等待时间，默认 120000ms；非正数/非数字回退默认值                              |

## API 摘要

| Method     | Path                                            | 说明                                                                     |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| GET        | `/api/snapshot`                                 | 全量状态                                                                 |
| POST       | `/api/demo/seed`                                | 种子数据                                                                 |
| POST       | `/api/projects`                                 | 打开/注册项目                                                            |
| POST       | `/api/sessions`                                 | 新建 Session                                                             |
| GET        | `/api/workers`                                  | Worker 列表                                                              |
| GET        | `/api/workers/registry`                         | Catalog v2：snapshot 状态 + 全部分发 + 兼容扁平 `agents` 投影            |
| POST       | `/api/workers/registry/prepare`                 | `202` 启动 Owner 准备操作（npx/uvx/binary）；绑定 manifestDigest / trust |
| GET/DELETE | `/api/workers/registry/operations/:operationId` | 查询或取消 prepare / Agent-auth 长任务                                   |
| POST       | `/api/workers/registry/register`                | Owner 从 installation materialize Worker（拒绝客户端 command）           |
| GET        | `/api/workers/:id/readiness`                    | ACP readiness / dispatch gate                                            |
| POST       | `/api/workers/:id/probe`                        | 重新 initialize/session-new 并刷新 readiness                             |
| GET        | `/api/workers/:id/auth-methods`                 | 获取 Agent 声明的公共认证方法                                            |
| POST       | `/api/workers/:id/authenticate`                 | `202` 启动可取消的 Agent 自管理认证操作                                  |
| POST       | `/api/workers/:id/secrets`                      | Worker-scoped env_var 密钥（只回 key names）                             |
| POST       | `/api/workers/:id/auth-terminal`                | 受控 terminal auth attempt（一次性 token，非 URL）                       |
| GET        | `/api/workers/:id/auth-terminal/:attemptId`     | 查询 terminal attempt 的公共状态                                         |
| WS         | `/api/workers/:id/auth-terminal/:attemptId/ws`  | xterm typed input/resize/cancel 与有界输出；token 仅走 subprotocol       |
| POST       | `/api/workers/:id/logout`                       | 仅当 Agent 宣告 auth.logout                                              |
| POST       | `/api/workers/:id/upgrade`                      | 显式升级到新版本 installation                                            |
| POST       | `/api/workers/:id/adopt-registry`               | 手工 Worker 采用 Registry 管理                                           |
| DELETE     | `/api/workers/:id`                              | 删除 Worker；不级联删仍被引用的 installation                             |
| POST       | `/api/workers/:id/toggle`                       | 启用/禁用                                                                |
| POST       | `/api/workers/:id/roles`                        | 设置 primaryRole + roles                                                 |
| POST       | `/api/workers/:id/health`                       | 健康检查                                                                 |
| GET/POST   | `/api/locale`                                   | 界面语言 `zh` \| `en`                                                    |
| GET        | `/api/approvals`                                | 审批列表（`?pending=1`）                                                 |
| POST       | `/api/approvals`                                | 入队                                                                     |
| POST       | `/api/dispatch`                                 | 按 role 委派（ACP 或 planned_unavailable）                               |
| GET        | `/api/git`                                      | 当前项目真实 git status                                                  |
| GET        | `/api/projects/:id/git`                         | 指定项目 git status                                                      |
| GET        | `/api/files`                                    | 当前项目目录列表                                                         |
| GET        | `/api/projects/:id/files`                       | 指定项目目录列表                                                         |
| POST       | `/api/demo/seed`                                | _调试_：用本仓库路径种子项目                                             |
| POST       | `/chat/router-leader`                           | AI SDK 兼容 Chat（默认 http-server 已提供）                              |
| GET        | `/api/activity`                                 | 最近活动事件                                                             |
| GET        | `/api/settings`                                 | 模型目录 + 已配置 key 状态（不含明文）                                   |
| POST       | `/api/settings`                                 | 保存 `leaderModel` + secrets（加密落盘并注入 env）                       |
| DELETE     | `/api/settings/secrets`                         | 删除某个 env key                                                         |

### ACP 审批与 Session 恢复 API

| 方法 | 路径                                | 说明                                                                                                                                  |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/api/sessions/:id/approval-policy` | 设置 Session 自动审批策略。Body: `{ approvalPolicy: 'manual' \| 'allow_once' \| 'allow_always' \| 'reject_once' \| 'reject_always' }` |
| POST | `/api/approvals/:id/resolve`        | 审批决定。Body: `{ optionId, decision: 'allow'\|'deny'\|'cancel', surface: 'chat'\|'panel' }`。已解决返回 409。                       |
| POST | `/api/jobs/:id/acp-context/reset`   | 重置 ACP 上下文。仅定位 Job 所属 Router Session/Worker 的映射；catalog 损坏时返回 503。                                               |

Session/Project 删除、Worker 执行配置变更时，顺序固定为：关闭 live entry → 事务性删除本地 catalog 映射 → 限时 best-effort 远端 delete/close。项目删除会在一次 catalog mutation 中清理所有 Session。远端失败不回滚本地成功删除，也不持久重试。

**审批策略规则**：

- `delete` 始终人工（任何策略不可覆盖）
- `read/search/think` 优先自动通过（`allow_once` → `allow_always` fallback）
- 其余 ToolKind 按 Session 策略精确匹配 option.kind；不存在时转人工

## 路线图

| Phase | 内容                                                                                |
| ----- | ----------------------------------------------------------------------------------- |
| **0** | 骨架 + GUI + Leader tools                                                           |
| **1** | `@agentclientprotocol/sdk@1.2.1` 委派 + 审批队列 + fresh/stale 模型缓存（已完成）   |
| **2** | Session 持久复用 + 实时 Worker 卡片 + 审批/catalog 边界加固（已完成代码与自动验证） |
| **3** | 长任务 / 并行 Worker / 产品化                                                       |

## License

MIT
