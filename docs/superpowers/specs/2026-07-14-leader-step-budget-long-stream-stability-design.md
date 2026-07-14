# Leader 步骤预算与长流稳定性设计

日期：2026-07-14

## 1. 背景与已确认根因

长对话中出现了两个彼此独立、但可由同一长流场景触发的问题。

### 1.1 Leader 静默停止

现场 thread `thread_0a47wj6m_mrj50omz` 的一轮对话顺序执行了 5 次
`dispatchWorkerTool`。第 5 次 Job `job_ynoyirdk_mrjyzgio` 实际成功，Claude Code
返回 `J9`，但 Leader 没有进入下一次模型调用来处理这个工具结果。

当前 Chat 请求没有显式传入 `maxSteps`。项目安装的 Mastra 1.50.1 默认
`maxSteps=5`，达到预算属于正常停止条件，不会进入异常处理，也不会写入
`useChat.error`。因此用户看到流安静结束，而不是任务错误。

`untilIdle: true` 只负责 background task 的后续唤醒，不能扩大普通阻塞工具调用的
step budget。Leader 的 `goal.maxRuns` 也不是 `maxSteps`，两者不能互相替代。

### 1.2 React 长流更新深度错误

浏览器 component stack 为：

```text
AI SDK stream write
  -> ReactChatState.replaceMessage
  -> messages subscribers
  -> useSyncExternalStore.forceStoreRerender
  -> Maximum update depth exceeded
```

当前 `useChat` 未配置 `experimental_throttle`。模型 token、reasoning、tool part、
`data-worker-run` 与 ChatPanel 计时更新并存时，AI SDK 外部 Store 会高频通知 React。
Worker state、history cleanup 和受控 `details` 中还存在无变化也创建新对象的路径，
进一步放大整棵 ChatPanel 的更新次数。

这不是 Mastra step budget 的直接结果，也不是 Worker/ACP 失败。

## 2. 目标

- Leader 单轮默认允许 500 个 step。
- 用户可以在设置页“运行”标签中配置 `leaderMaxSteps`，范围为 10–1000。
- 服务端是执行预算的权威来源，客户端不能绕过范围限制。
- 预算耗尽时不能静默结束：当前页面立即提示，刷新后提示仍存在。
- 提示提供“继续”按钮；点击后沿用同一 Router Session、Mastra thread 和 resource。
- 长时间流式输出保持实时可见，不再触发 React maximum update depth。
- 不改变 Worker timeout、Job 并发、ACP Session 复用或 Goal maxRuns 的语义。

## 3. 非目标

- 不删除 step budget，也不自动无限续跑。
- 不在本次修复中改造为 Mastra Workflow。
- 不升级 React、AI SDK 或 Mastra 依赖。
- 不改变 `WORKER_JOB_TIMEOUT_MS`、`ACP_SESSION_IDLE_MS`、Session pool 或取消策略。
- 不实现每个 Session 或每个模型独立的 maxSteps 覆盖。

## 4. 设置模型与校验边界

Core 设置新增：

```ts
interface AppSettings {
  leaderModel: string
  thinkingIntensity?: ThinkingIntensity
  leaderMaxSteps: number
  customProviders?: CustomProviderSettings[]
  updatedAt?: string
}
```

统一常量：

```ts
const DEFAULT_LEADER_MAX_STEPS = 500
const MIN_LEADER_MAX_STEPS = 10
const MAX_LEADER_MAX_STEPS = 1000
```

设置规范化规则：

- 只接受有限整数。
- 允许范围包含 10 和 1000。
- 保存 9、1001、`NaN`、无限值或小数时返回明确校验错误，不静默截断。
- 旧 `settings.json` 缺少字段时读取为 500；无需单独迁移脚本。
- `saveSettings` 必须保留未随本次 payload 提交的已有字段。

Electron IPC、HTTP `/api/settings`、Desktop API 类型和 preload 类型必须同步更新。
两条设置路径使用同一 Core 校验函数，不能各自实现不同边界。

## 5. 设置页

`SettingsPanel` 新增“运行”标签页。首个配置项为 Leader 单轮步骤上限：

- `type="number"`，`min=10`，`max=1000`，`step=1`。
- 默认显示服务端返回的当前值。
- 文案说明 step 包含模型生成、工具调用和工具结果处理；提高数值会增加耗时与成本。
- 非整数或越界时显示字段级错误，并禁用保存。
- 保存成功后重新读取设置，确认服务端最终值。
- 中英文文案必须同时补齐。

本次不在 Chat toolbar 暴露临时覆盖，也不建立单独的运行设置 API。

## 6. Chat 执行预算

Chat HTTP 入口在每次请求开始时读取最新 `leaderMaxSteps`，并把同一值传给
`handleChatStream` 的实际 `params` 和 `defaultOptions`。

服务端组装顺序必须保证：

```ts
params: {
  ...sanitisedClientParams,
  maxSteps: leaderMaxSteps,
  untilIdle: true,
}
```

客户端 body 中的 `maxSteps` 不得覆盖服务端设置。Activity Chat 事件记录
`leaderMaxSteps`、threadId、runId（可获得时）和模型，便于复盘。

## 7. 预算耗尽判定

定义纯函数，以 Mastra `onFinish` 数据和当前有效预算为输入：

```ts
type LeaderStepBudgetEvent = {
  type: 'exhausted'
  maxSteps: number
  stepsUsed: number
  finishReason: string
  runId?: string
  createdAt: string
}
```

只有同时满足以下条件才生成事件：

1. `steps.length >= effectiveMaxSteps`；
2. 最终 `finishReason === 'tool-calls'`。

理由：最终 step 已经发起并完成工具调用，但没有剩余 step 让 Leader 处理工具结果。
即使该 step 在工具调用前包含说明文本，任务仍可能未完成，因此不以 aggregate text 是否
为空作为判断条件。

普通 `finishReason='stop'`、用户取消、流错误和未达到预算的 tool call 不生成该事件。

## 8. 持久化与当前流呈现

预算耗尽不是错误横幅，而是类型化 Chat 数据 part：

```text
data-leader-step-budget
```

服务端处理顺序：

1. 让 Mastra 正常完成并保存当前 Assistant message。
2. 在 `onFinish` 中取得当前响应的 DB message id。
3. 若判定耗尽，将 `data-leader-step-budget` 追加到同一 Assistant message。
4. 通过 `leaderMemory.saveMessages` 以同一 id 更新消息。
5. 写入前检查同一 `runId` 或同一 message 是否已有 marker，保证重试幂等。

当前响应同时通过 finish message metadata 传递相同事件。前端立即显示 metadata；
页面刷新后从持久化的 data part 恢复。两条路径共用同一展示模型，避免产生两张提示卡。

持久化失败不能改变原 Assistant/Worker 结果，但必须记录完整 server log 和 Activity 事件；
当前页面仍通过 metadata 显示非持久化提示。

## 9. 继续行为

提示卡文案说明：本轮已使用 `stepsUsed/maxSteps`，任务可能尚未完成。

“继续”按钮直接向当前 `memoryThreadId/resourceId` 发送：

```text
继续完成上一轮未完成的任务。请先处理最后一个工具结果，不要重复已完成步骤。
```

约束：

- 不创建新的 Router Session 或 Mastra thread。
- 点击后获得一轮新的、完整的配置预算。
- busy 时按钮禁用，防止重复提交。
- 只有当前 thread 最新且后面没有 user message 的 marker 可点击。
- 历史 marker 保留记录，但不允许从旧位置续跑。
- 不自动点击、不自动循环，也不在额度耗尽后后台续跑。

## 10. React 长流稳定性

### 10.1 AI SDK 消息节流

`useChat` 配置：

```ts
experimental_throttle: 50
```

目标约为 20 FPS，合并 message/data 外部 Store 通知。Worker 服务端已有的 50ms delta
batching 保留，因此用户仍可实时看到进度。

### 10.2 Worker state 单一 reducer

生产代码统一使用 `workerRunReducer`，删除 ChatPanel 内重复 switch。Reducer 必须满足
引用稳定性：

- 重复或旧 sequence 返回原 `Map`。
- 未知 Job 的 delta 返回原 `Map`。
- terminal 后 delta 返回原 `Map`。
- terminal 内容完全相同时返回原 `Map`。
- 只有状态实际变化才创建新 `Map` 和新 entry。

历史 seed 与 terminal cleanup 拆成可测试的纯函数，并遵循同一引用稳定规则。

### 10.3 其他无效更新

- 受控 `details` 的 `onToggle` 在目标值未变化时返回原 `metaOpen` 对象。
- `ChatWorkspace` 为每个 Session 提供稳定 callback；busy 值未变化时返回原 map。
- 保留 250ms 运行时长 tick，但它不能触发 Worker state 重建。
- 不在 render 中写入会触发 React state 的对象。

## 11. 错误处理

- 设置校验失败：HTTP 返回 400；Electron IPC reject；UI 保留用户输入并显示字段错误。
- Chat 正常错误：继续沿用 `useChat.error` 与 `formatChatError`。
- Step budget exhausted：使用提示卡，不归类为 error。
- Budget marker Memory 更新失败：记录 server log/Activity，当前页面仍提示，并标注刷新后可能丢失。
- 继续按钮发送失败：沿用 Chat error 展示，marker 保持可重试状态。

## 12. 测试与验收

### 12.1 Core

- 默认值为 500。
- 10、500、1000 可保存并重新读取。
- 9、1001、非整数和非有限值被拒绝。
- 旧设置缺字段时读取为 500。
- 部分更新不覆盖其他设置字段。

### 12.2 Mastra App

- 达到预算且以 `tool-calls` 结束时生成 marker。
- 普通 stop、未达到预算、取消和错误不生成 marker。
- 相同 message/run 重复执行保持单 marker。
- 客户端 body 的 maxSteps 不能覆盖服务端值。
- marker 追加失败不破坏原消息或 Chat 响应。

### 12.3 Desktop

- Worker reducer 的无变化输入保持引用相等。
- 大量重复/乱序 delta 不产生额外状态 commit。
- 最新未消费 marker 展示可用继续按钮。
- marker 后已有 user message 时按钮不可用。
- 继续消息沿用当前 thread/resource，busy 时不会重复发送。
- 设置页校验与服务端边界一致，中英文文案齐全。

### 12.4 集成验收

- 原先第 5 个 dispatch 返回后 Leader 能进入下一 step。
- 把预算设为 10 并构造耗尽后，当前页面立即提示；刷新后提示仍在。
- 点击继续后从最后工具结果继续，不重复已完成 dispatch。
- 长时间 reasoning/text/Worker delta 并行时不再出现
  `Maximum update depth exceeded`，最终文本和 Worker 输出完整、顺序正确。
- `npm run typecheck` 和相关 Node tests 全部通过。

当前 `worker-events-e2e-pipeline.test.ts` 对 `timed_out` 分支覆盖不全导致 typecheck
失败。实施时只做使联合类型穷尽的最小补全，再把全仓 typecheck 作为验收门禁。

## 13. 文档更新

- 更新 `docs/HANDOVER.md`：记录 `leaderMaxSteps` 默认值、范围、耗尽提示和继续行为。
- 更新 `README.md`：补充设置页“运行”配置与长任务边界。
- 检查旧文档中“默认 maxSteps=5”或“untilIdle 可保证无限续跑”的表述并修正。

## 14. 实施边界

建议拆成四个可独立 review 的任务：

1. Core/IPC/HTTP 设置链路与“运行”设置页。
2. Chat maxSteps 注入、耗尽检测、marker 持久化。
3. 提示卡、同 thread 继续行为与历史恢复。
4. React 流式节流、Reducer 引用稳定与长流回归验证。

全部任务完成并通过验收前，不提交业务实现代码。
