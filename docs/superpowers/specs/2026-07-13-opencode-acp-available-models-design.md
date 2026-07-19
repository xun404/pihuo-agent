# OpenCode ACP 可用模型与 SDK 1.2.1 迁移设计

> 状态：设计已评审通过；本文仅记录方案，不代表已经实现。
> 日期：2026-07-13

## 背景

Workers 面板当前为 OpenCode 调用 `opencode models`，得到已连接 provider 的完整模型目录。这个目录可以达到数百项，但它不能准确表达当前 ACP 会话通过稳定协议接口宣告的模型配置。

项目当前还通过 `@mastra/acp@0.3.0` 执行 ACP 任务和读取模型。该版本的 `AcpAgent.getAvailableModels()` 依赖旧的 `session.models` 字段；OpenCode 返回的是稳定的 `configOptions`，因此这条路径得不到模型。

实测结论：

- OpenCode 1.17.18 的 `opencode models` 会展开已连接 provider 的完整目录。
- OpenCode ACP 的 `session/new` 返回稳定 `configOptions`；模型配置为 select option。
- OpenCode 支持稳定的 `session/set_config_option`，可以在 prompt 前设置模型。
- `@mastra/acp@0.3.0` 不能从 OpenCode 的稳定 `configOptions` 读取模型。
- `@agentclientprotocol/sdk@1.2.1` 可与当前 OpenCode、Claude ACP agent 完成握手。

## 目标

- 将“可用模型”定义为当前 ACP 会话在 `configOptions` 中实际宣告、可通过稳定配置接口选择的模型。
- OpenCode 模型刷新不再调用 `opencode models`，不再返回 CLI 全目录，也不再注入 Zen fallback。
- 使用 `@agentclientprotocol/sdk@1.2.1` 建立项目自有 ACP runtime，替换 `@mastra/acp`。
- 统一模型刷新与任务执行的会话生命周期、取消、权限、文件系统和错误处理。
- 模型刷新失败时保留旧缓存，并持久化标记为 stale。

## 非目标

- 不通过计费、余额或真实推理请求判断模型是否一定可调用。
- 不改变 Workers 模型接口的主要响应形状和现有手动刷新交互。
- 不在本次迁移中修复或升级其他 Agent CLI 的 ACP bridge；只记录兼容性缺口。
- 不复用 ACP 会话执行多个 job；每个任务保持独立进程和会话。

## 核心架构

在 `packages/adapters` 内提供资源作用域入口：

```ts
withAcpSession(config, callbacks, operation)
```

它负责：

1. 以 detached 进程组启动 ACP agent。
2. 通过 SDK 1.2.1 建立 JSON-RPC/NDJSON 连接。
3. 完成 initialize 和 session/new。
4. 向 operation 暴露 session、configOptions、prompt、更新流和 cancel 能力。
5. 在 `finally` 中幂等关闭会话、连接和子进程组。

`acp-runner.ts` 保持对应用层的 facade：

- `defaultCanRunAcp`
- `listAcpModels`
- `runAcpTask`

应用层不直接依赖 SDK 类型，也不直接管理 ACP 子进程。

## 模型刷新数据流

1. RightPanel 调用 `GET /api/workers/:id/models`。
2. API 调用 `listAcpModels(worker, { cwd })`。
3. OpenCode 模型发现使用真实用户 HOME 和 worker env，不使用任务隔离配置。
4. `withAcpSession` 创建短生命周期会话。
5. 从 `session/new.configOptions` 定位模型 select option。
6. 将非空 option value 去重并归一化为 `WorkerModelOption[]`。
7. 成功时覆盖缓存、更新时间并标记 fresh。
8. 失败时保留旧缓存；有旧缓存则返回 stale，无旧缓存则返回空列表。
9. 无论成功或失败，都关闭会话并回收进程组。

模型顺序以 ACP agent 返回顺序为准，不做付费/免费或 provider 启发式重排。

## 任务执行数据流

1. Scheduler 为 job 创建 `AbortController`。
2. OpenCode 继续通过现有 helper 创建隔离 HOME/config。
3. `runAcpTask` 将 `AbortSignal`、permission callback 和 worker pin 传给 `withAcpSession`。
4. session/new 后解析当前模型 config option。
5. 有 pin 时必须先确认 pin 在该会话 options 中。
6. 通过 `session/set_config_option` 设置 pin；无效 pin 明确失败，不静默改用默认模型。
7. 发送 prompt，并从 session update 流聚合 agent 文本。
8. 根据 stop reason 映射 job 结果。
9. `finally` 清理 ACP 资源。

## 模型缓存状态

`WorkerRegistration` 增加模型缓存自身的持久状态：

- `modelsState?: 'fresh' | 'stale'`
- `modelsError?: string`

语义：

- fresh：最近一次模型刷新成功，`availableModels` 与 `modelsFetchedAt` 同次写入。
- stale：最近一次刷新失败；`availableModels` 和 `modelsFetchedAt` 仍指向上次成功结果。
- 未设置：尚未发起过模型刷新。
- 首次刷新即失败：没有可展示缓存，但状态仍写 stale，并记录本次错误。

通用 worker health 仍同步反映本次 ACP 模型探测是否成功，但它不能代替模型缓存状态。

## 取消与进程回收

取消或超时顺序固定为：

1. 取消 job 关联的 pending approvals。
2. settle 对应 approval waiters。
3. 向活动会话发送 `session/cancel`。
4. 默认等待 2 秒宽限期，允许环境变量覆盖。
5. 关闭连接。
6. 对进程组发送 TERM。
7. 仍未退出时发送 KILL。

cleanup、cancel 和 waiter settle 都必须幂等，以覆盖用户取消、timeout、agent 退出同时发生的竞态。

## 文件系统安全

SDK client 的文本读写 handler 只能访问任务 cwd：

- 相对路径在 cwd 下解析。
- 绝对路径必须仍位于 cwd。
- 现存目标使用 realpath 校验。
- 新文件使用最近存在父目录的 realpath 校验。
- 拒绝 `..` 穿越、symlink 逃逸、目录和非普通文件。
- 限制单次读写大小。
- 不记录文件内容、环境变量或凭据到错误日志。

## stop reason

- `end_turn`：成功。
- `cancelled`：取消。
- `max_tokens`、`max_turn_requests`、`refusal`：失败，保留部分输出。
- transport EOF、异常退出、协议错误、模型设置失败：失败，保留受限长度 stderr 摘要。

## 测试策略

- stub ACP transport 的确定性单元/集成测试为硬性验收。
- 本机存在 OpenCode/Claude 时条件执行 live smoke，并记录 CLI 版本和结果。
- 未验证的其他 Agent CLI live 路径不作为本次验收门槛，必须在交接文档记录原因。
- 最终运行 `npm test`、`npm run typecheck`、`npm run build`。

## 已知风险

- OpenCode 的 ACP 宣告列表仍可能很大；本设计保证语义是“会话可选择”，不承诺少量结果。
- 不同 ACP agent 对 `configOptions` 的命名可能不同；解析器必须以稳定字段优先，并对缺失模型 option 明确报错。
- 真实 CLI smoke 受用户认证、网络和本机配置影响，因此与 stub 硬性测试分离。
- 其他 Agent CLI 的 bridge/本机安装问题不在本次范围内；SDK 迁移后仍可能存在个别 CLI 不可用。
