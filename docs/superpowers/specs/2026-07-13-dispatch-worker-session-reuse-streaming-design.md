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

- 第一阶段不跨 Router Agents 服务重启恢复 ACP session。
- 第一阶段不使用 ACP `session/load` 或 `session/resume` 做跨进程恢复。
- `wait=false` 的后台 Job 不在 Leader Chat 中持续流式展示；它继续由 Jobs 面板承载。
- 不把 Claude Code、Codex 或 OpenCode 重构成 Mastra 原生 subagent。
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

- `routerSessionId` 是 Router Agents 的产品 Session ID，不是全局 active session。
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
```

事件顺序必须满足：

```text
started -> delta* -> completed | failed | cancelled
```

每个 Job 只允许一个 terminal 事件。文本进入事件和 Job store 前统一移除 ANSI escape 与危险控制字符。

Scheduler 通过回调或订阅接口发布事件，不直接导入 Mastra writer。`runAcpTask`/Manager 提供原始 delta；Scheduler 负责 Job 元数据和 terminal 状态。

### 5.5 Mastra 流桥接

`dispatchWorkerTool.execute(input, context)` 在默认 `wait=true` 路径订阅当前 Job 的 `WorkerRunEvent`，通过 `context.writer.custom()` 输出统一 `data-worker-run`。

规则：

- 每次 `writer.custom()` 都必须 `await`。
- started 和 delta 使用 `transient: true`，不写入 Memory。
- delta 在桥接层每 50ms 合并一次；缓冲达到 8,192 字符时提前 flush，单个事件不得超过 8,192 字符。
- terminal 事件使用 `transient: false`，`id` 固定为 `jobId`，进入消息历史。
- writer 不存在时，Job 仍正常执行并返回结构化 tool result。
- writer 写入失败只记录投递失败，不自动重试 Worker prompt，也不把已经运行的 Job 标记失败。
- tool 的 `abortSignal` 触发时，请求 Scheduler 取消对应 Job；取消会进入统一 terminal 事件。

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

- Worker 名称或标准类型名，例如 Codex、Claude Code、OpenCode
- role（存在时）
- model（存在时，可弱化显示）
- `运行中 | 已完成 | 失败 | 已取消`

运行时正文使用等宽 `pre-wrap`，避免不完整 Markdown 抖动；terminal 正文使用现有 `MarkdownContent`。失败和取消保留已收到的部分输出。

最终输出沿用 `JOB_OUTPUT_MAX_CHARS = 32_000`。发生截断时 `truncated=true`，卡片必须显示“输出已截断”。

Leader instructions 明确：Worker 卡片是原始结果来源；Leader 应说明使用了哪个 Worker，并做简短归纳或下一步决策，不重复粘贴完整 Worker 输出。

## 6. 取消、失效与资源回收

采用“宁可失去复用，也不复用状态不确定的 session”：

| 场景 | 行为 |
| --- | --- |
| 用户取消 | 发送 `session/cancel`，最多等待 2 秒结束当前 turn，然后关闭并淘汰该 ACP session |
| prompt 超时 | cancel 后执行 TERM/KILL 回收，标记 broken 并淘汰 |
| CLI/transport 退出 | 当前 Job 失败，立即从池删除条目 |
| initialize/session new 失败 | 不写入池，Job 明确失败 |
| model/command/args/env 改变 | 标记旧条目失效；运行中的 prompt 结束后关闭，后续 dispatch 新建 |
| cwd 改变 | 进入不同复用键；旧条目按 TTL/LRU 回收 |
| Router Session 删除 | 取消关联 Job，并关闭该 Session 的全部条目 |
| Project 删除 | 先解析其 Session，再关闭关联条目并删除项目数据 |
| 服务退出 | 停止接收新 prompt，等待短暂宽限后 `closeAll`，最终保证进程组退出 |

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

1. 同一 Router Session 让 Codex 记住随机短语，再次 dispatch 能回答该短语。
2. 新建 Router Session 后，同一 Codex 不知道上一 Session 的短语。
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

- 同一复用键连续调用能维持 Worker 对话上下文，跨边界调用无法共享上下文。
- 所有异常和生命周期事件均按本文规则关闭或淘汰 session。
- Leader Chat 能实时看到带 Worker 标签的输出。
- terminal 卡片刷新后可恢复，实时 delta 不进入 Memory。
- Leader 不重复粘贴 Worker 的完整最终输出。
- `wait=false` 行为没有被伪装成 Chat 流式支持。
- session manager、scheduler bridge、desktop reducer 和历史恢复测试全部通过。
- `npm test`、`npm run typecheck`、`npm run build` 通过。
- `docs/HANDOVER.md` 与实施 plan 的 Todo、Check、Result Return Area 完成回填。
