# ACP Session、审批与实时卡片边界加固设计

> 日期：2026-07-14
> 状态：用户已批准
> 基线设计：`docs/superpowers/specs/2026-07-14-acp-approval-chat-session-recovery-design.md`
> 目的：修正第三轮代码 Review 暴露的实现偏差；未明确变更的产品规则继续沿用基线设计

## 1. 目标

本次加固必须同时满足以下结果：

1. ACP context identity 在进程重启前后稳定，且不同 Router Session、Worker、cwd、command、args、model 或执行相关 env 绝不串用。
2. Catalog 对损坏、写失败和未配置均 fail closed；不得以未持久化的内存状态继续执行 prompt。
3. new、resume、load 三条路径使用同一套模型校验和错误语义；配置的 model 未生效时绝不执行 prompt。
4. server-private `agentSessionId`、reuse key、canonical cwd 和 env 不进入 Job、Chat Memory、AppSnapshot、Activity 或客户端错误。
5. HTTP server 与 Mastra Studio 使用同一个 ACP runtime composition。
6. Session、Project、Worker 配置变更和显式 reset 同时完成严格的本地清理与限时 best-effort remote cleanup。
7. ACP permission options、人工 resolve API 和 Approval audit 使用严格、可持久审计的协议字段。
8. approval timeout、cancel 和迟到 ACP 结果只能产生一个一致终态。
9. Desktop 对实时事件与 snapshot 的合并单调；硬刷新可恢复当前 Session 的 running 和 pending Worker 卡片。

## 2. 非目标

- 不改变 Leader 的选人、role 路由或 `dispatchWorkerTool` 对外参数。
- 不把 `agentSessionId` 暴露给 Leader 或 Desktop。
- 不自动重放中断的 task。
- 不通过 Agent `session/list` 猜测旧 Router Session 的 context。
- 不新增独立审批 SSE/WebSocket。
- 不引入持久 remote-cleanup janitor 队列；远端清理失败只做安全日志和后续自然过期。
- 不把完整 Worker command/args/env 写进 catalog；远端清理使用调用前从 Store 捕获的 Worker 配置。

## 3. 采用的方案

采用“契约优先、分域修复”：先收紧 identity/catalog/recovery，再统一 Mastra composition 与 lifecycle，随后修审批状态机，最后修 Desktop hydration。每个分域独立执行 RED-GREEN-REFACTOR，并在进入下一分域前完成局部 Review。

不采用逐行最小补丁，因为 global fingerprint、catalog port、审批持久事实和 UI snapshot cursor 必须形成一致契约。也不采用完整事件溯源重构，因为其范围超过本次缺陷修复。

## 4. Session identity 与执行环境

### 4.1 环境分型

`SessionEntryConfig.env` 的语义固定为显式 `WorkerRegistration.env`，不再传入预先合并的 `process.env`。Manager 负责在 spawn 前构造：

```text
effectiveSpawnEnv = ambient process.env + explicit Worker.env
```

fingerprint provider 则接收两个独立参数：

```text
explicit Worker.env
ambient process.env
```

只有基线设计确认的 ambient exact/prefix/suffix 白名单参与 fingerprint；`PWD`、`SHLVL`、`TERM_SESSION_ID`、`SSH_AUTH_SOCK` 和 `_` 等噪声只有在用户显式写入 Worker.env 时才参与。

### 4.2 无歧义 canonical

command、args、model 和 env 使用结构化 JSON canonical。env 表示为按 key 排序的 tuple 数组：

```ts
Array<[string, string]>
```

禁止使用 `k=v|k=v` 或其他可被 value 伪造边界的拼接。args 保留数组边界。fingerprint 继续使用 master-derived、domain-separated HMAC；catalog key digest 使用完整 reuse identity，不截断 fingerprint。

### 4.3 依赖注入

稳定 fingerprint provider 属于 `AcpSessionManager` 实例配置。生产 Scheduler 和 reset route 必须通过已配置 Manager 构造 reuse key，不依赖 module-global 可变函数。生产 runtime 开启 `catalogRequired`；catalog/fingerprint 缺失时返回安全配置错误。`ACP_SESSION_REUSE=0` 是唯一允许的无 catalog 一次性路径。

## 5. Catalog 事务与校验

### 5.1 完整 schema

每条 v1 record 必须验证：

- `version === 1`；
- 非空 `keyDigest/routerSessionId/workerId/canonicalCwd/executionFingerprint/agentSessionId`；
- `capabilities.loadSession/resume/close/delete` 均为 boolean；
- `state` 仅为 `ready | stale`；
- `createdAt/lastUsedAt` 及可选 `lastRecoveredAt` 为有效 ISO 时间；
- `staleReason` 仅在存在时为 string。

任一 record 非法即隔离整个 catalog 并进入 unavailable，不能跳过坏 record 或当作空文件。

### 5.2 Copy-on-write

所有 mutation 使用相同事务顺序：

1. clone 当前 records；
2. 在 clone 上执行 upsert/stale/delete；
3. 将 clone 写入 temp，fsync，rename，并在支持的平台 fsync parent directory；
4. 成功后才替换内存 Map；
5. 任一步失败即把 catalog 标为 unavailable、清除可服务内存状态并抛出 `catalog_repair_required`。

Manager 不捕获后继续 prompt。new Session 只有在 model 成功应用且 ready record 成功持久化后才可进入 prompt。recovery upsert 失败同样不得继续。

### 5.3 Record 时间

恢复成功更新 `lastUsedAt` 和 `lastRecoveredAt`，保留原 `createdAt`。每次成功 prompt 更新 `lastUsedAt`。Catalog port record 必须包含 `version`，禁止依赖 TypeScript method bivariance 写入缺 version 的对象。

## 6. 恢复、模型与安全错误

### 6.1 固定恢复状态机

```text
live hit -> live_reused
catalog miss -> new
catalog hit + resume capability -> resume only
catalog hit + no resume + load capability -> load only
catalog hit + neither -> recovery_not_supported
resume/load runtime failure -> mark stale + fail closed
```

resume 运行失败不得再尝试 load；load 只是不支持 resume 时的 capability fallback。已有 mapping 的 `recovery_not_supported`、`session_not_found` 和 `recovery_failed` 均允许用户显式 reset。

### 6.2 模型应用

new/resume/load 在 prompt 前调用同一个 `applyPinnedModelOrThrow`：

- 有 model pin 时，Agent 必须声明可选择的 model option；
- pin 必须精确存在；
- `session/set_config_option` 必须成功；
- 任一条件不满足时 Job 明确失败，不发 started，不执行 prompt。

new 路径在 model 应用成功前不写 ready catalog；失败时 best-effort remote close/delete。recovery 路径 model 失败保留原 ready mapping，因为 context 本身仍可能有效；只关闭本次 live connection，待配置修复后再次恢复。

### 6.3 错误边界

使用真正的 typed Error class/type guard，公开字段仅为：

```ts
code
publicMessage
canResetAcpContext
```

内部 cause 可用于脱敏日志，但不能序列化到 Job 或 WorkerRunEvent。公开 message 不包含 `agentSessionId`、reuse key、cwd、command、args 或 env。Scheduler 不 JSON stringify 任意 thrown object；只有 recovery error 才填 `recoveryError`，普通 `error` 与 recovery block 不重复显示相同文案。

## 7. Mastra composition 与生命周期

### 7.1 单一 bootstrap

新增 Mastra app 内的 ACP runtime bootstrap，负责：

- 应用 secrets/env 初始化；
- 构造默认 catalog path；
- 注入稳定 fingerprint；
- 开启 `catalogRequired`；
- 注入 Worker 配置解析器和 remote cleanup；
- 注册 shutdown close。

`http-server.ts` 与 `mastra/index.ts` 都必须调用该 bootstrap。初始化必须幂等；若 singleton 已以不兼容配置创建则立即报错，不能静默忽略后续配置。两个 server surface 保持 Session/Project DELETE、approval resolve、policy 和 reset route parity。

### 7.2 真实 capabilities

Driver 从 SDK `agentCapabilities` 读取：

- `loadSession`；
- `sessionCapabilities.resume`；
- `sessionCapabilities.close`；
- `sessionCapabilities.delete`。

Catalog 禁止硬编码 close/delete。Driver 提供 typed `closeSession()` 与 `deleteSession()`；transport `close()` 只关闭本地连接，不冒充远端 lifecycle method。

### 7.3 本地必删、远端 best effort

delete/reset/invalidate 的顺序为：

1. 在 Store mutation 前捕获受影响 records 与对应 Worker 配置；
2. 确定性关闭 live entry；
3. 事务性删除本地 catalog mapping；
4. 启动有超时上限的异步 remote cleanup。

远端优先调用 `session/delete`。若只支持 close，则按可用的 resume/load 恢复后调用 `session/close`。失败只记录不含 session ID、cwd 或 env 的安全 code；不回滚已经成功的本地删除，也不阻塞用户操作。TTL/LRU/正常 shutdown 只 close，不 delete catalog。

## 8. Permission、API 与持久审计

### 8.1 Strict ACP options

ACP permission request 进入策略引擎前必须满足：

- options 数组非空；
- `optionId` 和 `name` 为 trim 后非空字符串；
- `kind` 为 `allow_once | allow_always | reject_once | reject_always`；
- `optionId` 在本次 request 内唯一。

任一条件失败即以安全协议错误明确失败当前 Job；不创建 pending ApprovalItem、不伪造 Allow/Deny、不降级为可手工选择。该决定取代基线设计中“空 options 只允许 cancel”的旧语义。

### 8.2 Shared 与迁移

`ApprovalOption.kind` 为 required `PermissionOptionKind`。旧 snapshot 中缺失/非法 kind 的 option 在 migration 时丢弃，绝不根据 name 或 optionId 推断。历史 ApprovalItem 可保留为空 options，但不能再被 allow/deny resolve。

`createApprovalItem` 不提供默认 options。自动审批写入 Agent 原始完整 option。人工 API 必须提供 `surface: chat | panel`；缺失或非法 surface 返回 400，不能默认记为 `manual_chat`。

### 8.3 原子审计

Store 的 resolved mutation 同时持久化：

- selected option 的 id、name、kind；
- decision；
- `resolutionSource`；
- `resolutionReason`；
- `resolvedAt`。

自动路径使用 `policy` source，不 settle 不存在的 waiter。人工/系统路径在 Store 一次 mutation 中完成事实更新，再 settle waiter 和 emit event。客户端不能提交 `policy/system` source。

## 9. Approval timeout 与唯一终态

人工 permission 的状态转换固定为：

```text
running -> pending_approval -> running -> terminal
```

人工 allow、deny 或 cancel resolve 后，只要 Job 尚未 terminal，都先恢复 running；ACP 的后续 prompt stopReason 决定最终终态。

approval timeout 执行：

1. 原子把 ApprovalItem 记为 cancelled/system/timeout；
2. emit `approval_resolved`；
3. abort 当前 ACP prompt；
4. emit 唯一 `failed` terminal；
5. finish Job 为 failed。

Scheduler 在 `enqueuePrompt` 返回或抛错后先检查最新 Job；只要已经是任意 terminal 状态就丢弃迟到结果，不再 emit 第二个 terminal，也不覆盖 Store。`finish()` 必须保证 runtime/timeout/approval waiter 都被清理。

## 10. Desktop 单调 hydration

### 10.1 Approval cursor

`WorkerRunState` 保存 UI-only approval cursor/tombstone：

```ts
{
  approvalId: string
  createdAt: string
  resolved: boolean
}
```

比较规则：

1. 同一 approvalId 的 resolved 永远高于 pending；
2. 不同 approvalId 先比较 `createdAt`，再以 approvalId 做稳定 tie-break；
3. 旧 resolved 不能清除更新的 pending；
4. 实时 resolved tombstone 拒绝迟到的同 ID pending；
5. terminal Worker event 清理 pending，但保留足以拒绝 stale snapshot 的 cursor。

Snapshot merge 对等输入返回原 Map，避免 React update-depth 循环。

### 10.2 硬刷新恢复

`ChatWorkspace` 向每个 keep-alive ChatPanel 传入 `snapshot.jobs`、`snapshot.workers` 和 `snapshot.approvals`。ChatPanel 只选择当前 Router Session 的 Job，并按以下顺序恢复：

1. 从持久 message terminal parts 恢复历史终态；
2. 从 snapshot jobs 补 running/pending live state；
3. 用 approval cursor 合并 snapshot approvals；
4. 最后应用实时 WorkerRunEvent。

硬刷新后 running 与 pending Job 都显示一张 live card。`pending_approval` Job 没有对应 pending ApprovalItem 时按 running 恢复并等待下一 snapshot/event，不能制造无按钮的僵尸 pending 卡。

reset 成功后本地 state 立即清除 recovery action，并从 snapshot 中的 Job reset marker 保持刷新后一致；重复 reset 被禁用。

## 11. 测试策略

所有生产改动遵循 RED-GREEN-REFACTOR，并至少包含：

### 11.1 Identity 与 catalog

- ambient noise 不改变 fingerprint，显式同名 env 会改变；
- `{A:'b|C=d'}` 与 `{A:'b', C:'d'}` 不同；
- Manager/Scheduler 不把 merged process env 当 explicit env；
- malformed record 导致 unavailable；
- flush 失败后旧 Map/文件不被未提交 mutation 污染，catalog fail closed；
- record version 与 timestamps 完整；
- production required mode 缺 catalog/fingerprint 明确失败。

### 11.2 ACP protocol

- Manager 经 fake ACP 完成 new -> persist -> 新 Manager -> resume/load -> prompt；
- resume 运行失败不调用 load/new；
- unsupported 可 reset；
- model invalid/setConfig failure 不 prompt；
- catalog upsert failure 不 prompt；
- recovery error/Job/event 序列化不含 agentSessionId/cwd/reuse key；
- close/delete 使用真实 capabilities 和方法。

### 11.3 Composition 与 lifecycle

- HTTP/Studio bootstrap 都配置同一 runtime contract；
- 两个 route surface 的 Session/Project DELETE parity；
- local delete 不依赖 remote 成功；
- remote cleanup 捕获删除前 Worker 配置、遵守 timeout 且日志脱敏。

### 11.4 Approval 与 Scheduler

- 空、非法、重复 options 失败 Job；
- missing surface、decision/kind 不匹配返回 400；
- auto/manual/system audit 在 snapshot 中保留 option.kind/source/reason；
- timeout abort prompt，迟到 success/error 均不产生第二终态；
- manual cancel approval 恢复 running。

### 11.5 Desktop

- 新 pending + 旧 resolved 保留新 pending；
- live pending a2 + stale resolved a1 不清除 a2；
- live resolved a1 + stale pending a1 不复活；
- 空 reducer state 可从 jobs/workers/approvals 恢复 running 与 pending；
- 等价 snapshot no-op；
- reset marker 刷新后仍禁用重复 action。

## 12. 验证与完成定义

完成前必须取得本轮新鲜证据：

```bash
node --import tsx --test packages/**/*.test.ts apps/**/*.test.ts
npm run typecheck
npm run build
git diff --check
```

还必须完成：

- Manager 到 fake ACP 的跨实例恢复集成测试，不以 monkey-patched `openAndBind` 代替；
- Catalog 写失败 fault test，不以“重读未损坏文件”冒充；
- HTTP 与 Studio route/composition parity 测试；
- Desktop reducer/hydration 的三组乱序复现测试；
- 全量 diff 安全检查，确保无 agentSessionId/env/task/history/test catalog 进入客户端或仓库数据。

自动测试通过后重新从 session isolation、approval concurrency、terminal uniqueness、snapshot monotonicity 四个角度 Review；发现的新问题继续进入失败测试与修复循环，直到没有 P0/P1 finding。

## 13. 决策记录

| 日期       | 决定                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 2026-07-14 | 采用四个修复域连续实施：session/catalog -> lifecycle/composition -> approval -> desktop。     |
| 2026-07-14 | 非 live context 使用调用前捕获的 Worker 配置执行限时异步 remote cleanup；不新增持久 janitor。 |
| 2026-07-14 | 空或 malformed ACP permission options 明确失败当前 Job，不生成只可取消的人工审批。            |
| 2026-07-14 | recovery model apply 失败保留 ready mapping，但禁止 prompt。                                  |
| 2026-07-14 | 硬刷新恢复当前 Router Session 的 running 与 pending Worker 卡片。                             |
