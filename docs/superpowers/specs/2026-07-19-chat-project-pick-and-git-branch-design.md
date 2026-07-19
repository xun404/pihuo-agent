# Chat 项目选择与 Git 分支切换 — 设计文档

- 日期：2026-07-19
- 范围：`apps/desktop`（renderer + electron）、`packages/core`、`packages/mastra-app`
- 参考实现：`/private/tmp/zcode-app/app.asar`（ZCode v3.3.6）
- 约束：**不修改现有 UI 结构与样式风格**，仅替换数据源 / 增加交互入口

## 1. 背景与问题

### 1.1 项目选择使用"上传"对话框
- `apps/desktop/src/components/OpenProjectModal.tsx:203-216` 用 HTML `<input type=file webkitdirectory>` 选择文件夹，触发的系统面板确认按钮是 macOS/Chrome 的"上传"（在 `OpenProjectModal.tsx:26, 262-266` 已注释承认这点）。
- **后端原生文件夹选择器已完整实现但未被调用**：
  - IPC 通道 `dialog:openDirectory`（`apps/desktop/electron/main.ts:682-712`）
  - 多平台实现 `pickProjectDirectory`（`apps/desktop/electron/pick-directory.ts:213-245`，含 Electron/osascript/PowerShell/zenity，按钮文案"选择此文件夹"）
  - 渲染层封装 `apps/desktop/src/lib/native-dialogs.ts:pickProjectDirectory()` 已存在
- 初始 Chat 空状态（`apps/desktop/src/components/ChatWorkspace.tsx:125-151`）只有问候语，**没有打开项目的入口**，用户必须去左侧栏点"打开项目…"。

### 1.2 Git 分支切换完全缺失
- 唯一的 git 集成是只读 `getGitStatus`（`packages/core/src/git-status.ts`，仅 `status --porcelain` / `rev-parse --abbrev-ref HEAD` / numstat）。
- 全代码库**无任何** `git switch` / `git checkout` / `git branch` / `git for-each-ref` 调用。
- `Project.defaultBranch` 字段（`packages/shared/src/index.ts:297-305`）只在两处起作用：
  - `ChatPanel.tsx:1133-1138` 作为 composer context-bar 的静态文本
  - `RightPanel.tsx:640` 作为只读展示
- Scheduler / spawn 层从不读取 `defaultBranch`，Worker 仅靠 `cwd` 绑定（`packages/mastra-app/src/scheduler.ts:1204-1217`、`packages/adapters/src/acp-session.ts:231-236`）。
- Session 数据模型（`packages/shared/src/index.ts:307-322`）无 branch 字段。

### 1.3 ZCode 参考模式（来自 app.asar 分析）
- **项目选择**：`window.zcode.selectDirectory()` → `dialog.showOpenDialog({properties:["openDirectory","createDirectory"]})`，返回 `string | null`。空状态菜单项"打开文件夹"。
- **分支切换**：Popover + cmdk 列表，仅当 `isGitAvailable && isRepository` 时显示。Host 进程用 `git for-each-ref refs/heads --format=...` 列分支，`git switch --no-guess` 切换，带脏文件检测和"提交后切换"辅助流程。会话进行中也可切换。

## 2. 设计决策（已与用户确认）

| 决策 | 选择 | 理由 |
|---|---|---|
| 分支功能范围 | **完整 zcode 风格** | 切换 + 新建 + 脏目录"先提交再切换" + 冲突/worktree 占用等错误处理 |
| 分支选择器位置 | **Composer 上下文栏**（复用 `ChatPanel.tsx:1133-1138` 位置） | 改动最小，会话中可见 |
| 项目选择改造程度 | **原生选择器 + 初始页加入口**（保留 modal 作为"粘贴路径"备用） | 依现状，去除"上传"文案 |
| 分支切换语义 | **真正 `git switch`，运行中 worker 警告** | 贴合 zcode 语义，worker 看到的代码随分支变 |

### 2.1 附加架构决策

- **分支操作走 HTTP API**（与现有 `/api/projects/:id/git` 一致），不走 Electron IPC。
  - 理由：与浏览器/远程模式兼容；避免在 `main.ts` 堆积 git 业务逻辑；现有 `/api/git` 路由已是此模式。
- **git 逻辑放在 `packages/core`**（`git-status.ts` 同级新增 `git-branches.ts`），复用现有 `runGit` 封装风格。
- **不新增 Project 持久化分支字段**。真实分支由 git 工作区状态决定，避免持久数据与实际状态漂移。`defaultBranch` 保留作可选种子值（创建项目时若提供则首次 `git switch` 到它），但运行时 UI 以 `git rev-parse --abbrev-ref HEAD` 为准。
- **Worker 不感知分支**：仍按 cwd 绑定。切换分支是用户对工作区的显式操作，worker 自然看到新分支代码。

## 3. 实现方案

### 3.1 项目选择改造（去除"上传"）

#### 3.1.1 `OpenProjectModal.tsx` — 主按钮改用原生选择器
- `browse()`（`:89-99`）改为调用 `pickProjectDirectory()` from `native-dialogs.ts`：
  ```ts
  const result = await pickProjectDirectory({ title, buttonLabel: '选择此文件夹' })
  if (result.ok) applyPath(result.path)
  else if (result.reason !== 'canceled') setError(...)
  ```
- 删除 `<input type=file webkitdirectory>` DOM（`:203-216`）和 `onDirInputChange`（`:101-191`）的路径解析逻辑。
- **保留** `directory-from-files.ts` 及其测试（`directory-from-files.test.ts` 独立存在，不属于本次清理范围）；仅移除 OpenProjectModal 对它的导入。
- Modal 文案更新：去掉"上传"相关说明（`:262-266`），改为"点击下方按钮选择文件夹，或直接粘贴绝对路径"。
- Modal 顶部主按钮："选择文件夹…"→ 调原生选择器。
- 保留文本输入 + "确定"，作为粘贴路径的备用入口。

#### 3.1.2 `ChatWorkspace.tsx` 初始空状态加入口
- 在 `:143` 的 `<p className="home-hint">` 后增加一个"打开项目…"按钮：
  ```tsx
  {!project && (
    <button className="btn btn-primary home-open-btn" onClick={onOpenProjectDirect}>
      <IconFolder size={14} /> {t('chat.openProject')}
    </button>
  )}
  ```
- 新增 prop `onOpenProjectDirect: () => void`，由 `App.tsx` 注入：先调原生 `pickProjectDirectory()`，成功则 `openProject(path)`（复用 `useAppState.openProject`，`:73-80`）。**不再走 `OpenProjectModal`**。
- 仅在 `!project`（确实无项目）时显示；已有项目时保持现状问候语。
- 样式复用现有 `.btn-primary`（`apps/desktop/src/styles/` 已有），不新增 CSS。

### 3.2 Git 分支能力（后端）

#### 3.2.1 `packages/core/src/git-branches.ts`（新文件）

类型定义：
```ts
export interface BranchInfo {
  name: string
  isCurrent: boolean
  upstreamName?: string
  commitHash?: string
  commitTimestampMs?: number
}

export interface BranchListResult {
  ok: boolean
  isRepo: boolean
  headRefType: 'branch' | 'detached'
  currentBranchName: string | null
  branches: BranchInfo[]
  dirtyFileCount: number
  error?: string
}

export type BranchSwitchIssueCode =
  | 'tracked-changes-would-be-overwritten'
  | 'untracked-changes-would-be-overwritten'
  | 'conflicts-present'
  | 'operation-in-progress'
  | 'branch-in-other-worktree'
  | 'target-branch-not-found'
  | 'request-failed'

export interface BranchSwitchIssue {
  code: BranchSwitchIssueCode
  message: string
  paths?: string[]
}

export interface BranchSwitchResult {
  ok: boolean
  action: 'switch' | 'create'
  branchName: string
  didChange: boolean
  issues: BranchSwitchIssue[]
  error?: string
}
```

函数（实现参考 zcode host）：
- `listLocalBranches(rootPath): Promise<BranchListResult>`
  - 先 `rev-parse --is-inside-work-tree` + `rev-parse --abbrev-ref HEAD` + `status --porcelain`（复用 `getGitStatus` 中的逻辑或独立实现）
  - `git for-each-ref refs/heads --format=%(refname:short)%00%(upstream:short)%00%(objectname)%00%(committerdate:unix)`
  - 解析后排序：current 优先，再按 `commitTimestampMs` desc，再字母序
- `switchBranch(rootPath, targetBranchName): Promise<BranchSwitchResult>`
  - 预检：`git status --porcelain` → 若有 tracked 改动且目标分支不同 → 用 `git checkout <target> -- .`（dry-run 思路用 `git merge-tree` 或直接捕获 `git switch` 错误）；最简实现：直接 `git switch --no-guess <target>`，捕获 stderr 按 zcode 错误模式分类为 `BranchSwitchIssue`
  - 错误分类正则：
    - `Your local changes.*would be overwritten` → `tracked-changes-would-be-overwritten`
    - `The following untracked working tree files would be overwritten` → `untracked-changes-would-be-overwritten`
    - `you need to resolve your current index first` → `conflicts-present`
    - `Another git process seems to be running` → `operation-in-progress`
    - `already checked out at` → `branch-in-other-worktree`
    - `did not match any file(s) known to git` → `target-branch-not-found`
- `createBranchAndSwitch(rootPath, branchName, startPoint?): Promise<BranchSwitchResult>`
  - `git branch <name> [startPoint]` → `git switch --no-guess <name>`
- `commitAndSwitch(rootPath, targetBranchName, message): Promise<BranchSwitchResult>`
  - 辅助流程：`git add -A` → `git commit -m <message>` → `switchBranch(...)`
- `export` 从 `packages/core/src/index.ts:50-57` 旁补充导出

#### 3.2.2 `packages/mastra-app/src/routes/api.ts` — 新增路由

紧邻现有 `/api/projects/:id/git`（`:830-840`）：

```ts
// GET /api/projects/:id/branches → BranchListResult
registerApiRoute('/api/projects/:id/branches', {
  method: 'GET',
  handler: async (c) => {
    const project = lookupProject(c.req.param('id'))
    if (!project) return c.json({ error: 'project not found' }, 404)
    return c.json(await listLocalBranches(project.rootPath))
  },
})

// POST /api/projects/:id/branches/switch → BranchSwitchResult
//   body: { targetBranchName: string }
registerApiRoute('/api/projects/:id/branches/switch', { method: 'POST', ... })

// POST /api/projects/:id/branches/create → BranchSwitchResult
//   body: { branchName: string, startPoint?: string }
registerApiRoute('/api/projects/:id/branches/create', { method: 'POST', ... })

// POST /api/projects/:id/branches/commit-and-switch → BranchSwitchResult
//   body: { targetBranchName: string, message: string }
registerApiRoute('/api/projects/:id/branches/commit-and-switch', { method: 'POST', ... })
```

路由注册位置与现有 `/api/git`、`/api/projects/:id/git` 同区。鉴权沿用现有 middleware（Bearer token）。

### 3.3 前端类型与 API 客户端

#### 3.3.1 `apps/desktop/src/lib/api.ts`
新增方法（紧邻 `gitStatus` `:579-582`）：
```ts
listBranches: (projectId: string) =>
  request<BranchListResult>(`/api/projects/${encodePathSegment(projectId)}/branches`),
switchBranch: (projectId: string, targetBranchName: string) =>
  request<BranchSwitchResult>(`/api/projects/${encodePathSegment(projectId)}/branches/switch`, {
    method: 'POST', body: JSON.stringify({ targetBranchName }),
  }),
createBranchAndSwitch: (projectId: string, branchName: string, startPoint?: string) =>
  request<BranchSwitchResult>(`/api/projects/${encodePathSegment(projectId)}/branches/create`, {
    method: 'POST', body: JSON.stringify({ branchName, startPoint }),
  }),
commitAndSwitch: (projectId: string, targetBranchName: string, message: string) =>
  request<BranchSwitchResult>(`/api/projects/${encodePathSegment(projectId)}/branches/commit-and-switch`, {
    method: 'POST', body: JSON.stringify({ targetBranchName, message }),
  }),
```
类型从 `@swarmdesk-agent/core` 重新导出。

### 3.4 前端 Hook

#### 3.4.1 `apps/desktop/src/hooks/useGitBranches.ts`（新文件）

```ts
interface UseGitBranchesArgs {
  projectId: string | undefined
  rootPath: string | undefined
  enabled?: boolean  // 默认 true；可在非 git 项目时关闭
}
interface UseGitBranchesResult {
  loading: boolean
  isRepo: boolean
  currentBranchName: string | null
  branches: BranchInfo[]
  dirtyFileCount: number
  error: string | null
  refresh: () => Promise<void>
  switchTo: (target: string) => Promise<BranchSwitchResult>
  createAndSwitch: (name: string, startPoint?: string) => Promise<BranchSwitchResult>
  commitAndSwitch: (target: string, message: string) => Promise<BranchSwitchResult>
  mutationPending: boolean
}
```

行为：
- mount/projectId 变化时 `listBranches(projectId)`
- 暴露 `refresh`，UI 可在切换成功后调用
- 内部 `isRepo` 由首次 list 结果判定；非 repo 时后续不轮询
- 节流：同一 target 的 switch 在 mutationPending 期间禁用

### 3.5 UI — `BranchSwitcher` 组件

#### 3.5.1 `apps/desktop/src/components/BranchSwitcher.tsx`（新文件）

替换 `ChatPanel.tsx:1133-1138` 的静态 `defaultBranch` span。

渲染条件：`project && git.isRepo`（isRepo 来自 `useGitBranches`）。

结构（仿 zcode，使用 framer-motion 与项目现有 pop-menu 风格）：
```
<button className="ctx branch-trigger" onClick={toggle}>
  <IconBranch size={13} />
  <span>{currentBranchName ?? t('git.branchSwitcher.loading')}</span>
  {loading || mutationPending ? <Spinner/> : <span className="caret">▾</span>}
</button>

<AnimatePresence>
  {open && (
    <motion.div className="pop-menu branch-menu" role="menu">
      <input className="branch-search" placeholder={t('git.branchSwitcher.searchPlaceholder')} />
      <div className="branch-list" role="group">
        {filteredBranches.map(b => (
          <button className={`pop-item${b.isCurrent ? ' on' : ''}`} onClick={() => onPick(b)}>
            <IconBranch size={14} />
            <span className="branch-name">{b.name}</span>
            {b.isCurrent && dirtyFileCount > 0 && (
              <span className="branch-dirty">
                {t('git.branchSwitcher.currentDirty', { count: dirtyFileCount })}
              </span>
            )}
            {b.isCurrent && <IconCheck />}
          </button>
        ))}
        {!loading && filteredBranches.length === 0 && (
          <div className="branch-empty">{t('git.branchSwitcher.empty')}</div>
        )}
      </div>
      <div className="branch-footer">
        <button className="pop-item" onClick={openCreateDialog}>
          <IconGitBranch size={14} /> {t('git.branchSwitcher.createAction')}
        </button>
      </div>
    </motion.div>
  )}
</AnimatePresence>

{createDialogOpen && <CreateBranchDialog ... />}
{switchAssistStep && <CommitAndSwitchDialog ... />}  {/* 脏目录阻塞时触发 */}
```

#### 3.5.2 运行中 worker 警告
`switchTo` 实现前置 check。**不调 `api.listWorkers`**（它是全局接口，不接受 projectId）；改用 ChatPanel 已经持有的 `snapshotWorkers` prop 过滤本项目运行中 worker：

```ts
const switchTo = async (target: string) => {
  // snapshotWorkers 由 ChatPanel 传入，已属本项目（worker.projectId === project.id）
  const running = snapshotWorkers?.filter(
    (w) => w.projectId === project?.id && w.status === 'running'
  ) ?? []
  if (running.length > 0) {
    const ok = await window.routerAgents.dialog.confirm(
      t('git.branchSwitcher.workerWarning', { count: running.length })
    )
    if (!ok) return { ok: false, action: 'switch', branchName: target, didChange: false, issues: [] }
  }
  const result = await api.switchBranch(projectId, target)
  if (!result.ok) {
    // 分类 issue，若有 tracked-changes-would-be-overwritten → 打开 CommitAndSwitchDialog
  } else {
    toast.success(t('git.branchSwitcher.toast.switchSuccess', { branchName: target }))
    await refresh()
  }
  return result
}
```

`WorkerRegistration` 类型中 `projectId` 与 `status` 字段需在实现时核对（若 `status` 不存在，回退判定条件改为「worker 有进行中的 job」—— `snapshotJobs` 里 `workerId` 匹配且未完成）。

#### 3.5.3 子对话框
- `CreateBranchDialog`：分支名输入 + startPoint（可选）+ 确定/取消
- `CommitAndSwitchDialog`：当切换被 tracked 改动阻塞时显示，列出影响文件（来自 issue.paths），输入 commit message → `commitAndSwitch`

### 3.6 `ChatPanel.tsx` 改动

- `:1133-1138`：把静态 `defaultBranch` span 替换为 `<BranchSwitcher project={project} snapshotWorkers={snapshotWorkers} onAfterSwitch={...} />`
- `BranchSwitcher` 内部自管 `useGitBranches`，不污染 ChatPanel 现有 state
- 切换成功后调用 `onAfterSwitch`，触发 RightPanel 的 git 区刷新（通过 snapshot.revision bump 或自定义事件）

### 3.7 `RightPanel.tsx` 改动
- `:640` 的分支名显示：优先取 `useGitBranches().currentBranchName`，回退到 `gitStatus.branch`
- 保持只读展示风格不变

### 3.8 i18n
新增键（zh-CN/en），命名仿 zcode，写入现有 locale 文件：
- `chat.openProject`：打开项目…
- `git.branchSwitcher.label`、`searchPlaceholder`、`empty`、`currentDirty`、`createAction`
- `git.branchSwitcher.createDialog.*`
- `git.branchSwitcher.commitDialog.*`
- `git.branchSwitcher.workerWarning`
- `git.branchSwitcher.toast.switchSuccess` / `createSuccess`
- `git.branchSwitcher.error.*`（按 issue code 映射）

## 4. 错误处理

| 场景 | 行为 |
|---|---|
| 非 git 项目 | `BranchSwitcher` 不渲染；ChatPanel context-bar 不显示分支 chip |
| `git` 未安装 | listBranches 返回 `isRepo=false`；同上 |
| 切换被 tracked 改动阻塞 | 弹 `CommitAndSwitchDialog`，引导提交后切换 |
| 切换被 untracked 改动阻塞 | toast 提示具体文件（来自 issue.paths） |
| 冲突中 | toast 错误，不切换 |
| 分支被其它 worktree 占用 | toast 错误，列出 worktree 路径 |
| 目标分支不存在 | toast 错误 |
| 运行中 worker 存在 | `dialog.confirm` 警告，确认后才切换 |
| 网络错误 | toast 失败，UI 回退到上一次状态 |

## 5. 测试

### 5.1 单元测试
- `packages/core/src/git-branches.test.ts`：
  - `for-each-ref` 输出解析（含 upstream、commitTimestampMs）
  - current 分支标记
  - 排序：current first → 时间 desc → 字母
  - `switchBranch` 错误分类（喂入构造的 stderr 字符串，验证 issue code）
  - 脏文件计数
- `apps/desktop/src/components/BranchSwitcher.test.tsx`：
  - 非 repo 不渲染
  - loading 显示 spinner
  - 列表过滤
  - 点击切换调用 `switchTo`
  - 阻塞时打开 `CommitAndSwitchDialog`
- `apps/desktop/src/hooks/useGitBranches.test.ts`（如时间允许）：
  - mount 触发 listBranches
  - switchTo 成功后 refresh

### 5.2 集成 / 手测脚本
1. 打开非 git 项目 → composer 不显示分支 chip
2. 打开 git 项目 → 显示当前分支名
3. 点击触发器 → popover 列出本地分支，当前带 ✓
4. 搜索过滤
5. 切换到另一分支 → toast 成功 → composer 与 RightPanel 同步更新
6. 制造脏文件后切换 → 弹提交对话框 → 输入 message → 提交并切换
7. 启动 worker → 切换分支 → 弹 worker 警告
8. 创建新分支 → 自动切到新分支
9. 初始空状态点"打开项目…" → 弹原生选择器（无"上传"字样）
10. modal"选择文件夹…"按钮 → 弹原生选择器（无"上传"字样）

## 6. 实现顺序（建议）

1. `packages/core/src/git-branches.ts` + 单测
2. `packages/mastra-app/src/routes/api.ts` 新增 4 个路由
3. `api.ts` 客户端 + 类型导出
4. `useGitBranches.ts` hook
5. `BranchSwitcher.tsx` + 子对话框 + 单测
6. `ChatPanel.tsx` 接入 `BranchSwitcher`
7. `RightPanel.tsx` 分支名同步
8. `OpenProjectModal.tsx` 改用原生选择器
9. `ChatWorkspace.tsx` 初始页加入口 + `App.tsx` 接线
10. i18n 补齐
11. 手测 10 条用例

## 7. 不在本次范围

- 远程/历史分支拉取（zcode 也是 `--no-guess`）
- 推送 / 拉取 / rebase
- Git graph 可视化（zcode 有，本次跳过）
- 分支差异对比视图
- Worker per-branch 隔离（仍共享 cwd）
- 删除 `directory-from-files.ts`（不在本次范围；该文件有独立测试，保留）
