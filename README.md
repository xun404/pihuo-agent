# Router Agents

Mac 桌面「多智能体指挥台」：用 **Mastra Supervisor** 做 Leader，协调 **Claude Code / Codex / OpenCode** 等 CLI（ACP）Worker。

## Phase 状态

### Phase 0（完成）

- GUI 线框/高保真：`design/gui/`
- Monorepo 骨架：`packages/*` + `apps/desktop`
- 本地状态存储（Project / Session / Worker）
- Mastra Leader Agent + REST API + Chat 流式路由
- Desktop 三栏 UI（可先浏览器跑，Electron 入口已预留）
- **i18n**：中文 / English（标题栏切换，偏好可落盘）
- **Worker 角色**：`plan` · `coder` · `review` · `test` · `research` · `general`

### Phase 1（完成）

- **ACP 委派路径**：`dispatchToWorker` + `@mastra/acp` `createACPTool`（`packages/adapters`）
- CLI 不可用时返回 **`ok: false` + `mode: planned_unavailable`**（非静默成功）
- **审批队列**：`ApprovalItem` + `GET/POST /api/approvals` + `POST /api/approvals/:id/resolve`
- ACP `onPermissionRequest` → **等待** UI/API resolve（`waitForApprovalDecision`，可配置 `APPROVAL_TIMEOUT_MS`）
- 角色选择仍驱动委派（unit tests 覆盖）

### 真实路径（Git / Files / 注册，完成）

- **Git**：`GET /api/git` · `GET /api/projects/:id/git` — 真实 `git status --porcelain` + numstat；非仓库返回结构化错误
- **Files**：`GET /api/files` · `GET /api/projects/:id/files` — 真实目录树（有界深度）
- **打开项目**：`POST /api/projects` + UI「打开项目…」（按本地绝对路径）
- **注册 Worker**：右侧 Workers 表单 → `POST /api/workers`
- **Seed Demo / 模拟权限**：仅可选调试辅助，不是主路径
- **默认单端口**：`http-server` 同时提供 REST + `POST /chat/router-leader`（桌面 `useChat` 同源，不再 404）
- **Shared LocalStore**：HTTP 与 Leader tools 共用 `getSharedStore()`
- **Activity**：`GET /api/activity` 实时事件流（项目/审批/委派/chat）
- **设置页**：标题栏 ⚙ — API Keys + Leader 模型（Mastra `provider/model`）
- **安全存储**：AES-256-GCM 于 `~/.router-agents/secrets.enc`；Electron 下主密钥由 **safeStorage**（macOS Keychain / Windows DPAPI）包装

```bash
npm test                 # git / files / 审批 wait / 委派 / activity / secrets
npm run dev:mastra       # 默认 API+Chat :4111
npm run desktop          # Electron（自启 API+Chat + 安全存储）
# 或在设置页填写 OPENAI_API_KEY / ANTHROPIC_API_KEY 等，无需手写 .env
```

### Worker 默认角色

| Worker | 主角色 primaryRole | 可兼角色 roles |
|--------|-------------------|----------------|
| Claude Code | coder | coder, plan, research, general |
| Codex CLI | review | review, coder, test, general |
| OpenCode | general | general, coder, plan, test |

Leader 委派时优先按 **role** 选人，再落到具体 CLI。右侧 Workers 面板可点主角色循环、展开勾选 roles。

## 仓库结构

```
router-agents/
  design/gui/           # 交互式线框/高保真
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

默认：`http://localhost:4111`（`packages/mastra-app` 的 `http-server`：snapshot / workers / approvals / dispatch）

### 3. 启动 Desktop UI（终端 2）

```bash
npm run dev
```

浏览器打开：`http://localhost:5173`

1. 点 **Seed Demo** 创建示例 Project/Session  
2. 在 Chat 里描述任务（需配置 `OPENAI_API_KEY` 且使用 `dev:mastra:studio` 时 Leader chat 才完整）  
3. 右侧 **Approvals** →「模拟权限请求」→ 允许/拒绝  
4. `POST /api/dispatch` 在 CLI 未装齐时返回 `planned_unavailable`  

### 4. 测试

```bash
npm test
```

### 设计稿

```bash
npm run gui
# 或 open design/gui/index.html
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | Leader 默认 `openai/gpt-5.5` |
| `LEADER_MODEL` | 覆盖模型，如 `anthropic/claude-sonnet-4-6` |
| `MASTRA_PORT` | 默认 `4111` |
| `VITE_MASTRA_URL` | Desktop 连接的 API，默认 `http://localhost:4111` |

## API 摘要

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/snapshot` | 全量状态 |
| POST | `/api/demo/seed` | 种子数据 |
| POST | `/api/projects` | 打开/注册项目 |
| POST | `/api/sessions` | 新建 Session |
| GET | `/api/workers` | Worker 列表 |
| POST | `/api/workers/:id/toggle` | 启用/禁用 |
| POST | `/api/workers/:id/roles` | 设置 primaryRole + roles |
| POST | `/api/workers/:id/health` | 健康检查 |
| GET/POST | `/api/locale` | 界面语言 `zh` \| `en` |
| GET | `/api/approvals` | 审批列表（`?pending=1`） |
| POST | `/api/approvals` | 入队 |
| POST | `/api/approvals/demo` | 模拟 ACP 权限 |
| POST | `/api/approvals/:id/resolve` | `{ decision: allow\|deny\|cancel }` |
| POST | `/api/dispatch` | 按 role 委派（ACP 或 planned_unavailable） |
| GET | `/api/git` | 当前项目真实 git status |
| GET | `/api/projects/:id/git` | 指定项目 git status |
| GET | `/api/files` | 当前项目目录列表 |
| GET | `/api/projects/:id/files` | 指定项目目录列表 |
| POST | `/api/demo/seed` | *调试*：用本仓库路径种子项目 |
| POST | `/api/approvals/demo` | *调试*：模拟一条权限请求 |
| POST | `/chat/router-leader` | AI SDK 兼容 Chat（默认 http-server 已提供） |
| GET | `/api/activity` | 最近活动事件 |
| GET | `/api/settings` | 模型目录 + 已配置 key 状态（不含明文） |
| POST | `/api/settings` | 保存 `leaderModel` + secrets（加密落盘并注入 env） |
| DELETE | `/api/settings/secrets` | 删除某个 env key |

## 路线图

| Phase | 内容 |
|-------|------|
| **0** | 骨架 + GUI + Leader tools |
| **1** | `@mastra/acp` 委派路径 + 审批队列（当前） |
| **2** | Git / Files 实装 + Electron 打包 |
| **3** | 长任务 / 并行 Worker / 产品化 |

## License

MIT
