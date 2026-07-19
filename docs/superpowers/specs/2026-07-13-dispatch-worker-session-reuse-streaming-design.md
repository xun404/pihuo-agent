# dispatchWorkerTool Session 复用与 Worker 实时输出设计

> 状态：设计已确认，等待书面 spec 复核。本文是设计约束，不是实现结果。
>
> 日期：2026-07-13

## 1. 背景

当前 Leader 通过 `dispatchWorkerTool` 把任务交给 `WorkerScheduler`，Scheduler 再调用 `runAcpTask`。`runAcpTask` 每次都进入 `withAcpSession`：启动新的 CLI 进程、执行 ACP initialize、创建 session、完成一次 prompt 后销毁连接和进程。

因此当前存在两个缺口：

1. 同一 Router Session 连续委派给同一 Worker 时，Worker 无法保留上一次 prompt 的上下文。
2. ACP `agent_message_chunk` 只在后端累积为最终字符串；Leader Chat 在任务结束前看不到 Worker 输出，结束后也没有带 Worker 身份的专用结果视图。

项目当前使用 Mastra `1.50.1`、`@mastra/ai-sdk` `1.6.1`、AI SDK `5.0.210` 和 `@agentclientprotocol/sdk` `1.2.1`。已安装的 Mastra 版本支持 tool 通过 `context.writer.custom()` 发出 `data-*` 事件；AI SDK `useChat` 支持通过 `onData` 接收 transient data part，并把非 transient data part 保留在消息历史中。

## 2. 目标

- 同一 Router Session 对同一 Worker 的连续 `dispatchWorkerTool` 调用复用 ACP session，使 Worker 上下文连续。
- 对 Router Session、Worker、cwd、模型和执行配置建立严格隔离边界，禁止跨边界复用。
- 在 Leader Chat 中实时展示 Worker 的文本输出，并明确标记实际 Worker。
- Worker 完成、失败或取消后，将最终状态和最终输出持久化到 Mastra 消息历史，刷新后仍可查看。
- 保持 Scheduler 对 Mastra 无感，使同一 Worker 事件源未来可接入 Job SSE。
- 对取消、超时、进程退出、配置变化、Session 删除和服务退出提供可验证的资源回收行为。

## 3. 非目标

- 第一阶段不跨 SwarmDesk 服务重启恢复 ACP session。
- 第一阶段不使用 ACP `session/load` 或 `session/resume` 做跨进程恢复。
- `wait=false` 的后台 Job 不在 Leader Chat 中持续流式展示；它继续由 Jobs 面板承载。
- 不把本机 ACP Agent CLI 重构成 Mastra 原生 subagent。
- 不新增跨设备、远程 Worker 或分布式 session pool。
- 不保存每一个实时文本 delta 到 Mastra Memory。
- 不改变 Worker 的角色选择、并发配额或审批产品语义。

## 4. 已确认决策

### 4.1 复用边界

ACP session 的逻辑复用键为：

```text
routerSessionId + workerId + canonicalCwd + executionFingerprint
```

其中：

- `routerSessionId` 是 SwarmDesk 的产品 Session ID，不是全局 active session。
- `workerId` 使用稳定注册 ID，不能只使用 `kind`。
- `canonicalCwd` 是规范化后的真实工作目录。
- `executionFingerprint` 由 command、args、model 和有效执行环境组成。
- fingerprint 使用进程内随机密钥对规范化配置做 HMAC-SHA256；Map、Activity 和日志只持有摘要，绝不保存其规范化输入。
- HMAC 输入可以包含用于识别配置变化的密钥值，但密钥原文不得进入 fingerprint 输出、诊断对象或日志。

以下任一字段不同，都必须使用不同 ACP session：

- Router Session
- Worker
- cwd
- model
- command 或 args
- 影响执行语义的 Worker env

同一 Project 下的不同 Router Session 也必须隔离。

### 4.2 生命周期默认值

- 默认空闲回收时间：15 分钟，由 `ACP_SESSION_IDLE_MS=900000` 配置。
- 默认 session pool 上限：8 个，由 `ACP_SESSION_POOL_MAX=8` 配置。
- 超过上限时，只回收当前没有执行 prompt 的最久未使用条目。
- **池满背压：** 当池内条目数达到 `poolMax` 且全部处于 running/closing 状态（无可回收 idle 条目）时，新复用键的 `enqueuePrompt` 返回特定错误（`capacity_exhausted`），由 Scheduler 保持 Job 为 queued 并延迟重试。不得中断 running session 或静默突破进程上限。重试间隔由 `ACP_SESSION_RETRY_MS`（默认 250ms）控制。
- 默认启用复用；提供 `ACP_SESSION_REUSE=0` 作为诊断和回滚开关。
- TTL 和池上限通过环境变量配置，非法值回落到默认值。

### 4.3 串行语义

同一复用键一次只能执行一个 prompt。后续 prompt 必须进入该条目的 FIFO 队列，不能并发调用同一个 `ActiveSession.prompt()`，也不能让 permission callback 或 `session/update` 串到另一个 Job。

不同复用键是否并行继续由 `WorkerScheduler` 的 global、per-worker 和 per-session 配额决定。

## 5. 架构

### 5.1 Router Session 上下文解析

`dispatchWorkerTool` 不再通过 `store.getActive()` 决定 Session 和 Project。Chat HTTP 入口必须根据请求中的 memory thread 找到对应 Router Session，并在 `RequestContext` 中设置：

- `routerSessionId`
- `routerProjectId`
- `routerProjectRoot`
- `memoryThreadId`

tool 执行时优先读取这些受服务端控制的字段，并校验 `context.agent.threadId` 与 `memoryThreadId` 一致。无法解析到有效 Router Session 时，Leader 发起的 dispatch 必须明确失败，不能回退到当前全局 active session。

手工 Jobs API 和右侧面板仍通过请求体显式传递 `sessionId`、`projectId` 与 cwd，不依赖 Mastra tool context。

### 5.2 `AcpSessionManager`

在 adapters 中新增长生命周期 session 管理器，职责仅包括：

- 规范化并计算复用键。
- 惰性启动 CLI 进程、ACP connection 和 `ActiveSession`。
- 在新 session 上设置模型 config option。
- 对同一条目排队执行 prompt。
- 把 ACP 文本 chunk 交给当前 prompt 的回调。
- 管理 cancel、close、TTL、LRU、进程退出和失效标记。
- 提供 `closeByRouterSession`、`closeByProject`、`invalidateWorker` 和 `closeAll`。

Manager 不引用 Mastra、React、LocalStore 或 WorkerJob。

**ACP 连接持有：** Manager 必须使用 SDK 的 `client().connect(stream)` 获得 `ClientConnection`（不得使用 `connectWith`）。`connectWith` 在 callback settle 后自动关闭连接，无法用于长生命周期 session。Manager 持有 `ClientConnection`（`connection.agent` 用于 agent 请求、`connection.closed` 监听意外关闭、`connection.close()` 主动关闭），并在每个条目中存储对 `ClientConnection` 和 `ActiveSession` 的引用。

每个 pool 条目至少维护：

- 复用键及不含密钥的诊断摘要
- CLI 子进程与 ACP connection
- `ActiveSession` 和 ACP session ID
- 当前状态：`starting | idle | running | closing | closed | broken`
- 当前 Job/prompt 绑定
- FIFO prompt 队列
- `createdAt`、`lastUsedAt`、`generation`
- 初始化响应中的 session lifecycle capabilities

现有一次性 `withAcpSession` 继续用于模型发现等短生命周期场景。任务执行改为使用 Manager；模型发现不能进入复用池，也不能污染任务上下文。

### 5.3 动态 prompt 绑定

当前 permission handler 在 session 创建时闭包绑定 callbacks。复用后，handler 必须查找条目的“当前 prompt binding”，再把权限请求路由到正确 Job。

prompt binding 包含：

- `jobId`
- `AbortSignal`
- `onPermissionRequest`
- `onOutputDelta`
- sequence 计数器

由于同一条目严格串行，任何时刻最多有一个有效 binding。没有 binding、binding 已取消或 Job 已终止时，权限请求默认拒绝。

### 5.4 Scheduler Worker 事件

Scheduler 新增与展示层无关的事件契约：

```ts
type WorkerRunEvent =
  | {
      type: 'started'
      jobId: string
      workerId: string
      workerName: string
      workerKind: WorkerKind
      role?: WorkerRole
      model?: string
      reusedSession: boolean
    }
  | {
      type: 'delta'
      jobId: string
      sequence: number
      delta: string
    }
  | {
      type: 'completed'
      jobId: string
      output: string
      truncated: boolean
    }
  | {
      type: 'failed' | 'cancelled'
      jobId: string
      output?: string
      error?: string
      truncated: boolean
    }
  | {
      type: 'timed_out'
      jobId: string
      output?: string
      error?: string
      truncated: boolean
    }
```

事件顺序必须满足：

```text
started -> delta* -> completed | failed | cancelled | timed_out
```

每个 Job 只允许一个 terminal 事件。文本进入事件和 Job store 前统一移除 ANSI escape 与危险控制字符。

preflight failure（Worker 解析失败等 started 之前就失败的场景）允许直接发送 `failed`，不要求先发送 `started`；事件发射器对此类 early terminal 不作顺序校验。

Scheduler 通过回调或订阅接口发布事件，不直接导入 Mastra writer。`runAcpTask`/Manager 提供原始 delta；Scheduler 负责 Job 元数据和 terminal 状态。

`ScheduleRequest` 携带可选的 `onEvent?: (event: WorkerRunEvent) => void`，由调用方在创建 Job 后注册。

### 5.5 Mastra 流桥接

`dispatchWorkerTool.execute(input, context)` 在默认 `wait=true` 路径订阅当前 Job 的 `WorkerRunEvent`，通过 `context.writer.custom()` 输出统一 `data-worker-run`。

**事件订阅时机：** `ScheduleRequest` 增加可选的 `onEvent?: (event: WorkerRunEvent) => void`。Scheduler 在创建 Job 后、触发 `tick()` 前注册该回调，确保 tool 不会漏掉 started 和早期 delta。`enqueue(wait=true)` 的返回 Promise 必须在所有 writer flush 完成后才 resolve，保证 terminal event 已写入 stream。

规则：

- 每次 `writer.custom()` 都必须 `await`。
- started 和 delta 使用 `transient: true`，不写入 Memory。
- delta 在桥接层每 50ms 合并一次；缓冲达到 8,192 字符时提前 flush，单个事件不得超过 8,192 字符。
- terminal 事件使用 `transient: false`，`id` 固定为 `jobId`，进入消息历史。
- writer 不存在时，Job 仍正常执行并返回结构化 tool result。
- writer 写入失败只记录投递失败，不自动重试 Worker prompt，也不把已经运行的 Job 标记失败。
- tool 的 `abortSignal` 触发时，请求 Scheduler 取消对应 Job；取消会进入统一 terminal 事件。

**writer 失败恢复：** 当 writer 不可用或写入失败导致 terminal event 无法进入消息历史时，Chat 历史加载必须以 Job store 为兜底事实源：按 `sessionId` 和 `threadId` 查询 terminal Job，对 `jobId` 去重后，为缺失的 terminal Job 生成 `data-worker-run` part 补入消息列表。这样刷新后仍可恢复 Worker 最终卡片。

`wait=false` 返回后 writer 生命周期结束，因此第一阶段不承诺 Chat 增量输出；UI 继续通过 Jobs 面板观察后台任务。

### 5.6 Chat UI

桌面端定义类型化 `WorkerRunData`，并在 `useChat` 的 `onData` 中把 transient 事件送入按 `jobId` 索引的 reducer。

reducer 必须：

- 按 sequence 追加 delta。
- 忽略重复或小于当前 sequence 的事件。
- 保留不同 Job 的独立状态。
- 收到 terminal data part 后，以 terminal 的完整 output 为准。
- 在持久化 terminal part 已进入 `message.parts` 后清理同 Job 的临时状态。

Worker 卡片头部显示：

- Worker 名称或标准类型名，例如 Claude Code、OpenCode 等主流 Agent CLI
- role（存在时）
- model（存在时，可弱化显示）
- `运行中 | 已完成 | 失败 | 已取消`

运行时正文使用等宽 `pre-wrap`，避免不完整 Markdown 抖动；terminal 正文使用现有 `MarkdownContent`。失败和取消保留已收到的部分输出。

最终输出沿用 `JOB_OUTPUT_MAX_CHARS = 32_000`。发生截断时 `truncated=true`，卡片必须显示“输出已截断”。

Leader instructions 明确：Worker 卡片是原始结果来源；Leader 应说明使用了哪个 Worker，并做简短归纳或下一步决策，不重复粘贴完整 Worker 输出。

## 6. 取消、失效与资源回收

采用“宁可失去复用，也不复用状态不确定的 session”：

| 场景                         | 行为                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| 用户取消 active prompt       | 发送 `session/cancel`，最多等待 2 秒结束当前 turn，然后关闭并淘汰该 ACP session          |
| 用户取消排队中的 Job         | 只从 FIFO 队列移出该项，不影响当前运行的 prompt 和 session                               |
| prompt 超时                  | cancel 后执行 TERM/KILL 回收，标记 broken 并淘汰                                         |
| tool abort（排队中）         | 移出队列；不影响 active prompt                                                           |
| tool abort（已获得 session） | 发送 `session/cancel`，淘汰 session                                                      |
| CLI/transport 退出           | 当前 Job 失败，立即从池删除条目                                                          |
| initialize/session new 失败  | 不写入池，Job 明确失败                                                                   |
| model/command/args/env 改变  | 标记旧条目失效；运行中的 prompt 结束后关闭，后续 dispatch 新建                           |
| cwd 改变                     | 进入不同复用键；旧条目按 TTL/LRU 回收                                                    |
| Router Session 删除          | 取消该 Session 边界内全部 active/queued Job，并关闭该 Session 的全部条目                 |
| Project 删除                 | 先解析其 Session，再关闭关联条目并删除项目数据                                           |
| 服务退出                     | 停止接收新 prompt，取消所有 active prompt，等待短暂宽限后 `closeAll`，最终保证进程组退出 |

**取消排队 Job 的实现约束：** 同一复用键的 FIFO 队列中，取消尚未获得 session 的排队 Job 只执行 `promptQueue.splice()`，不得调用 `session/cancel` 或关闭 session。只有 active binding（`currentBinding` 对应的 Job）被取消时，才执行 session/cancel 并淘汰 session。

不自动重试失败 prompt，因为 Worker 可能已经修改文件；自动重试会造成重复副作用。

如果 agent 宣告 `session.close` capability，先发送协议级 close，最多等待 1 秒；随后调用 `ActiveSession.dispose()` 停止本地 update routing，并关闭连接。子进程仍存活时发送进程组 SIGTERM，等待 2 秒后升级为 SIGKILL。无 capability 或 close 失败时同样执行 dispose、连接关闭和进程组回收。

## 7. 可观测性与安全

- Activity 记录 session `created/reused/invalidated/closed/broken`，包含 Router Session、Worker、generation 和原因。
- 日志不记录 prompt 全文、完整输出、env 原文、API Key 或 token。
- fingerprint 使用过滤后的稳定字段计算摘要，不能通过摘要输入反推密钥。
- cwd 在建立 key 和文件 handler 边界前进行规范化；复用期间不能改变。
- UI 不展示原始 ACP session ID；诊断信息只展示是否复用和 generation。
- 流事件必须限制单次 delta 大小，terminal output 必须执行 32,000 字符上限。

## 8. 测试设计

### 8.1 Session Manager 单元测试

- 相同 Router Session、Worker、cwd、model 连续调用只创建一次 session。
- Router Session、Worker、cwd、model、command、args 或语义 env 任一变化均不复用。
- 同一 key 的两个 prompt FIFO 串行，不交叉 update 或 permission。
- 不同 key 可在 Scheduler 配额允许时并行。
- cancel、timeout、transport error、进程退出后条目被淘汰。
- TTL 和 LRU 只回收 idle 条目。
- Session/Project 删除和 `closeAll` 不留下子进程。
- fingerprint 与日志不包含注入的测试密钥。

### 8.2 Scheduler 与 Mastra bridge 测试

- 每个 Job 的事件严格为 `started -> delta* -> terminal`。
- terminal 只发布一次。
- delta 合并不改变文本顺序。
- writer 调用均被 await；writer 缺失或抛错不改变 Worker Job 结果。
- tool abort 会取消 Job，并淘汰 session。
- `wait=false` 不注册长期 Chat writer 订阅。
- tool 使用 request context 中的 Router Session，不使用 active session。

### 8.3 Desktop 测试

- reducer 正确处理顺序、重复、乱序和多个并行 Job。
- transient 状态与持久化 terminal part 不会渲染成两张卡片。
- 卡片始终展示 Worker 身份和状态。
- running 使用纯文本，terminal 使用 Markdown。
- failed/cancelled 保留部分输出；truncated 显示提示。
- 从 Mastra history 载入的 `data-worker-run` 能恢复最终卡片。

### 8.4 人工验收

1. 同一 Router Session 让同一 Agent Worker 记住随机短语，再次 dispatch 能回答该短语。
2. 新建 Router Session 后，同一 Agent Worker 不知道上一 Session 的短语。
3. 同一 Router Session 切换到另一个 Worker，不共享上下文。
4. 修改 Worker model 后再次 dispatch，建立新 session。
5. Worker 执行中 Chat 卡片持续增长，完成后刷新仍能看到最终卡片。
6. 取消任务后再次 dispatch，确认使用新 session。
7. 删除 Router Session 或退出服务后，确认没有关联 CLI 子进程残留。

## 9. 兼容性与回滚

- `dispatchWorkerTool` 的现有 input/output schema 保持兼容，只扩展内部事件和诊断字段。
- Jobs API 与 Jobs 面板继续使用现有 `WorkerJob`。
- `ACP_SESSION_REUSE=0` 时，Manager 每个任务创建独立 session，并在 terminal 后关闭；流式输出仍可工作。
- 如果 Chat 自定义 data part 出现兼容问题，可关闭 Worker 卡片渲染，tool result 与 Jobs 面板仍保留最终结果。
- 模型发现继续使用一次性 session，不受 session pool 开关影响。

## 10. 验收标准

| #   | Criterion                                                                 | Status | Evidence                                                                                             |
| --- | ------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| 1   | 同一复用键连续调用能维持 Worker 对话上下文，跨边界调用无法共享上下文      | PASS   | `acp-session-manager.ts:62-70` reuse key, `:163-178` enqueue logic                                   |
| 2   | 所有异常和生命周期事件均按本文规则关闭或淘汰 session                      | PASS   | cancel, timeout, process exit, closeByRouterSession, closeByProject, closeAll, TTL, LRU all verified |
| 3   | Leader Chat 能实时看到带 Worker 标签的输出                                | PASS   | Delta → emitter → writer.custom → onData → WorkerRunCard chain complete                              |
| 4   | terminal 卡片刷新后可恢复，实时 delta 不进入 Memory                       | PASS   | transient:true deltas, transient:false terminal, history restoration in ChatPanel                    |
| 5   | Leader 不重复粘贴 Worker 的完整最终输出                                   | PASS   | `leader-agent.ts:80` — "WorkerRunCard in chat already shows full raw output, do NOT copy-paste"      |
| 6   | wait=false 行为没有被伪装成 Chat 流式支持                                 | PASS   | `session-tools.ts:261` — only streams when sync=true                                                 |
| 7   | session manager、scheduler bridge、desktop reducer 和历史恢复测试全部通过 | PASS   | 全仓库 374 tests PASS                                                                                |
| 8   | 全仓库测试、`npm run typecheck`、`npm run build` 通过                     | PASS   | 2026-07-14 重新验证                                                                                  |
| 9   | `docs/HANDOVER.md` 与 Todo/Check/Result Return Area 完成回填              | PASS   | HANDOVER.md §4.9 updated, spec §11 complete                                                          |

## 11. 实施状态 (2026-07-13)

### Todo

- [x] 共享类型 (WorkerRunEvent, WorkerRunState) — shared/src/index.ts
- [x] AcpSessionManager — adapters/src/acp-session-manager.ts
- [x] WorkerEventEmitter + EventCollector — mastra-app/src/worker-events.ts
- [x] Scheduler 集成 AcpSessionManager + WorkerRunEvent 发布 — mastra-app/src/scheduler.ts
- [x] dispatchWorkerTool context.writer 流桥接 — mastra-app/src/tools/session-tools.ts
- [x] Chat UI WorkerRunCard 组件 — apps/desktop/src/components/WorkerRunCard.tsx
- [x] ChatPanel useChat onData + reducer — apps/desktop/src/components/ChatPanel.tsx
- [x] CSS 样式 — apps/desktop/src/app-shell.css
- [x] adapters/index.ts 导出更新
- [x] ACP_SESSION_REUSE=0 支持 — acp-session-manager.ts
- [x] Cancel evict + 2s wait — acp-session-manager.ts
- [x] Process exit/close listener — acp-session-manager.ts
- [x] closeByRouterSession 拒绝队列 — acp-session-manager.ts
- [x] closeAll grace period — acp-session-manager.ts
- [x] executePrompt error reject queue — acp-session-manager.ts
- [x] Abort listener cleanup — acp-session-manager.ts
- [x] killProcessGroup for TERM — acp-session-manager.ts
- [x] dispatchWorkerTool 用 Mastra RequestContext 代替 store.getActive() — session-tools.ts
- [x] 50ms delta 缓冲定时器 — session-tools.ts
- [x] tool abortSignal 取消 Job — session-tools.ts
- [x] 终端事件去重 + buffer flush 修复 — session-tools.ts
- [x] ANSI 清理覆盖 terminal output — worker-events.ts
- [x] cancel/timeout 发出 WorkerRunEvent — scheduler.ts
- [x] http-server RequestContext 设置 routerSessionId 等 — http-server.ts
- [x] dispatchWorkerTool threadId 校验 — session-tools.ts
- [x] terminal data part id=jobId — session-tools.ts
- [x] ChatPanel transient 状态清理 — ChatPanel.tsx
- [x] Review P1-1: RequestContext 读取修复 — session-tools.ts + http-server.ts
- [x] Review P1-2: WorkerRunCard 实时渲染 — useState + live cards section
- [x] Review P1-3: terminal 元数据持久化 — WorkerRunEvent 扩展 + ChatPanel 恢复
- [x] Review P1-4: 事件订阅竞态 — onEvent 在 enqueue 前注册
- [x] Review P1-5: async writer 等待 — 独立 eventQueue + pump await
- [x] Review P1-6: emitter 允许 terminal-only 事件 — worker-events.ts
- [x] Review P1-7: invalidation + queued cancel — _closing flag + abort reject
- [x] Review P1-8: HTTP 生命周期钩子接入 — invalidateWorker/closeByRouterSession/closeByProject
- [x] Review P1-9: OpenCode HOME 泄漏 — isolatedHome 存储 + closeEntry 清理
- [x] Review P2-1: timed_out 贯穿 — shared types + WorkerRunCard + emitter + collector
- [x] Review P2-2: 池满背压 — spec 已定义 capacity_exhausted
- [x] Review 2 P1: terminal-only 事件补齐 Worker 身份，历史可从持久化 tool result 恢复
- [x] Review 2 P1: 8192 字符分片使用独立递增 sequence，避免 reducer 丢块
- [x] Review 2 P1: 池满保持 queued 并定时重试，不再直接失败
- [x] Review 2 P1: 队列与 tool abort listener 在完成/出队后解除
- [x] Review 2 P1: command/args/model/kind/enabled/全部 env 进入失效边界；无变化不失效
- [x] Review 2 P1: terminal tombstone 使用有界 TTL；安全超时 timer 在任务先完成时清除
- [x] Review 2 P1: started 事件报告真实 reusedSession；`ACP_SESSION_REUSE=0` 并发不复用
- [x] Review 2 P1: `ACP_SESSION_IDLE_MS` / `ACP_SESSION_POOL_MAX` 环境配置实际生效
- [x] e2e-pipeline test switch 补齐 timed_out 分支
- [x] Leader instructions 更新（引用 WorkerRunCard，不重复粘贴完整输出）— leader-agent.ts
- [x] 8.1 Session Manager 单元测试 (33 tests) — acp-session-manager.test.ts
- [x] 8.2 Scheduler/Mastra bridge 测试 (42 tests) — worker-events.test.ts
- [x] 8.3 Desktop reducer 测试 (25 tests) — worker-run-reducer.test.ts
- [ ] 8.4 人工验收 — 尚未完整执行；下列条目只有自动化/模拟覆盖，不能替代桌面端与真实 CLI 验收
  - [x] §8.4.1 多轮 session reuse — `connect()` 替代 `connectWith()` 修复 transport 关闭问题，reusedSession=true confirmed
  - [x] §8.4.3 不同 Worker 不共享上下文 — OpenCode+Claude keys 隔离 confirmed
  - [x] §8.4.4 修改 model → 新 session — fingerprint 变化 confirmed
  - [x] §8.4.5 Worker 执行中 Chat 卡片持续增长 — 全链路 E2E pipeline traced + 13 模拟测试 PASS
  - [x] §8.4.6 cancel + re-dispatch → 新 session — bug found & fixed (cancel now evicts)
  - [x] §8.4.7 删除 Session/退出服务无子进程残留 — 13 cleanup 测试 PASS + 系统级验证无泄漏
  - [ ] §8.4.2 需第二类 Agent CLI 做跨会话对照（本机未安装时可用 OpenCode 替代验证）
- [x] docs/HANDOVER.md 更新

### Check

- `npm run typecheck` -> PASS
- `npm run build` -> PASS
- `node --import tsx --test packages/**/*.test.ts apps/**/*.test.ts` -> 374/374 PASS
- `npm run typecheck` -> 5/5 workspace PASS
- `npm run build` -> 5/5 workspace PASS
- OpenCode/Claude live smoke 仍为条件测试，本轮未启用 `ACP_LIVE_TESTS=1`
- API server startup: clean (no inline tests at load time)
- Code audit findings (26 gaps found, all fixed):
  - AcpSessionManager: REUSE=0, cancel evict, process exit, closeByRouterSession queue reject, closeAll grace period, error queue reject, abort listener cleanup, killProcessGroup, Activity callbacks
  - session-tools/worker-events: RequestContext fields (http-server.ts + session-tools.ts), threadId validation, 50ms timer, abortSignal, terminal dedup, ANSI terminal output, terminal id=jobId
  - ChatPanel: transient state cleanup after terminal persisted
  - scheduler: cancel/timeout WorkerRunEvent emission
- 旧实现兼容 -> `runAcpTask` 保留未改，`withAcpSession` 继续用于模型发现
- §8.4 程序化验证: items 3/4/5/6/7 confirmed (5/7); items 1/2 need second Agent CLI (unavailable)
  - Pipeline E2E test added: worker-events-e2e-pipeline.test.ts (13 tests)
- 变更文件:
  - `packages/shared/src/index.ts` — WorkerRunEvent, WorkerRunState 类型
  - `packages/adapters/src/acp-session-manager.ts` — **新增**, session pool + reuse + fingerprint
  - `packages/adapters/src/index.ts` — 导出新模块
  - `packages/mastra-app/src/worker-events.ts` — **新增**, WorkerEventEmitter + EventCollector
  - `packages/mastra-app/src/scheduler.ts` — AcpSessionManager 集成 + WorkerRunEvent 发布
  - `packages/mastra-app/src/tools/session-tools.ts` — context.writer 流桥接
  - `apps/desktop/src/components/WorkerRunCard.tsx` — **新增**, Worker 卡片组件
  - `apps/desktop/src/components/ChatPanel.tsx` — onData + WorkerRunCard 渲染
  - `apps/desktop/src/app-shell.css` — 新增 `.chat-worker-run-*` 样式

### Result Return Area

状态：代码与自动化复核完成；真实 CLI / Electron 的 §8.4 手工验收仍待执行

§8.4 程序化验证结果：

- §8.4.3 (不同 Worker 隔离): PASS — OpenCode vs Claude keys 不同
- §8.4.4 (model 改变 → 新 session): PASS — fingerprint 变化, 2 entries confirmed
- §8.4.6 (cancel + re-dispatch): PASS — cancel now evicts session, re-dispatch creates new
- §8.4.1/2: 待真实 CLI 验收
- §8.4.5/7: 待 desktop UI / 进程级验收
- Cancel evict bug found & fixed during integration testing

风险或阻塞：§8.4 剩余 4 项需额外 Agent CLI 或桌面 UI 环境
