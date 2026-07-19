# Desktop UI As-Built 设计规范

> **日期**：2026-07-16  
> **状态**：以当前 `apps/desktop` 实现为准（可提交源码）  
> **权威来源**：`apps/desktop/src/styles.css` + 相关组件  
> **非提交资源**：本地 `design/`（线稿 / 截图）**不得提交**；见仓库 `.gitignore`  
> **产品设计意图稿**（可能落后于实现）：`2026-07-16-desktop-ui-redesign-design.md`

本文从本轮桌面 UI 重构提炼**已落地**的设计规范，供后续改 UI 时对齐，避免再次散改布局或硬编码色值。

---

## 0. 原则

1. **对话主路径优先**：默认双栏（全高侧栏 + 主列）；Inspector **按需**打开，不永久三栏。
2. **单一样式表**：桌面视觉统一走 `apps/desktop/src/styles.css` Design System v3 token；禁止同屏散落未登记 hex / 字号 / 圆角。
3. **不挡操作的反馈**：瞬时成功/失败/提示用全局 Toast；**不得**用顶栏 banner 或改窗体高度挤布局。
4. **表单校验可就地**：字段错误（如步数、路径）可保留控件旁行内文案；与「操作结果提示」区分。
5. **图标线性 SVG**：功能图标禁止 emoji；品牌用 `Icons.tsx` / `provider-icons` 路径。
6. **线稿与截图本地化**：`design/` 仅本地对照，不进版本库；规范以本文 + 代码为准。

---

## 1. 应用壳与信息架构

### 1.1 双壳

| 模式 | 结构 | 入口 |
|------|------|------|
| **项目壳** | 左栏 + 主列（+ 可选 Inspector） | 有 active project 时默认 |
| **设置壳** | 全页替换（无项目侧栏）；`settings-nav` + `settings-main` | 侧栏左下「设置」唯一入口 |

```
项目壳:
┌──────────┬─────────────────────────────┬────────────┐
│ sidebar  │ main (chat / empty)         │ inspector? │
│ 全高     │                             │ 按需 300px │
└──────────┴─────────────────────────────┴────────────┘

设置壳:
┌──────────┬──────────────────────────────────────────┐
│ settings │ settings-main（常规/模型/Worker/关于）     │
│ -nav     │                                          │
└──────────┴──────────────────────────────────────────┘
```

### 1.2 布局 Token

| Token | 实现值 | 用途 |
|-------|--------|------|
| `--sidebar-w` | `232px` | 项目侧栏宽（与设置导航同宽） |
| `--settings-nav-w` | `232px` | 设置左导航 |
| `--drawer-w` | `300px` | Inspector |
| `--provider-rail-w` | `176px` | 模型设置供应商轨 |
| `--content-max` | `720px` | 设置主内容可读宽 |
| `--messages-max` | `800px` | 消息列最大宽 |

实现类：`.shell` / `.shell.with-inspector` / `.settings-shell`（见 `App.tsx`、`SettingsPanel.tsx`）。

### 1.3 macOS 窗口控件（左上三键）

> **规范目标**：关闭 / 最小化 / 最大化（traffic lights）的**视觉尺寸与间距必须与系统其他原生窗口一致**（如 Finder、备忘录、系统设置），不得显得偏小或偏密。

| 项 | 规范 |
|----|------|
| 来源 | **必须使用系统原生控件**（Electron `titleBarStyle: 'hiddenInset'` 等），**禁止** HTML/CSS 自绘彩色圆点替代 |
| 尺寸 | 圆钮直径、键间距、图标（× − ＋）以 **macOS 当前系统标准** 为准；应用侧**不得**通过缩放窗口内容、错误 `zoomFactor`、或自绘更小圆点使其偏小 |
| 位置 | 仅允许调整 `trafficLightPosition`（x/y 逻辑像素），使三键在预留标题带内**垂直光学居中**、距左缘符合系统 inset 习惯 |
| 预留区 | 侧栏 / 设置导航顶区（`.sidebar-top`）仅作 **拖拽 + 避让占位**，高度须覆盖三键热区与上下边距，避免三键贴内容或「缩在一角」造成**显得比系统小** |
| 交互 | 占位层可 `-webkit-app-region: drag`；可点控件区域勿被 web 层遮挡 |
| 线稿 | 线稿里的假圆点**不得**当作实现尺寸；实现以系统原生为准 |

**实现约定**

| 项 | 约定 |
|----|------|
| 绘制方式 | 原生三键；UI 仅 `.sidebar-top` 占位；禁止自绘替代 |
| 引擎 | Electron ≥ 42（较新 Chromium / SDK，接近 macOS 26 系统三键尺度） |
| 配置入口 | `apps/desktop/electron/main.ts`：`titleBarStyle: 'hiddenInset'` + `trafficLightPosition` / `setWindowButtonPosition`（约 `{ x: 16, y: 19 }`） |
| 占位样式 | `.sidebar-top` 高度 **52px**，与标题带 / 三键垂直居中配套 |
| 尺寸 | 圆钮本体由 **系统 + Electron 原生** 决定；应用侧只调位置与预留，不缩放窗口内容 |

**验收**

- 并排对比本应用与 Finder（或任意系统 App）同一显示器、同一缩放：三键直径与间距**无明显偏小**。
- 项目壳与设置壳左上一致；无自绘假按钮叠在原生钮上。

**若仍偏小：排查清单**

1. 是否误用了自绘 traffic lights（线稿残留 / 第三方 titlebar）。
2. 是否仍在跑旧 Electron 二进制（应 ≥ 42；`require('electron/package.json').version`）。
3. 标题带过矮或 `trafficLightPosition.y` 不当导致**光学上**显小（`.sidebar-top` = 52px，y ≈ 19）。
4. 与 Finder 的极限差异：取决于 Electron 构建所用 macOS SDK；无法用 CSS 放大原生圆钮本体。

### 1.4 侧栏

自上而下：

1. **系统** traffic lights 占位（见 §1.3；不自绘）
2. Brand（RA + Router）
3. 主操作：新建任务 · 打开项目
4. 「项目」分区 + 项目树
5. 底栏：仅「设置」

会话行：

- 选中：`--bg-active`
- 运行中 / 待审批：`.sess.run` / `.sess.approve` 色点（绿 / 橙）
- **两端圆角**：会话行两侧均圆角（与线稿一致，非仅一侧）

### 1.5 Inspector（RightPanel）

- 默认关闭；主列顶栏开关打开。
- Tabs（实现）：**Workers · Git · Files · 审批**（**无 Jobs**）。
- 外层 drawer 底色与侧栏体系一致；内层面 `surface`；Tab 激活为底部蓝指示条。
- 审批主路径仍在对话内 Worker 卡；Inspector 为运维总览。
- 顶区间距：与主列顶栏对齐，避免「贴顶过紧」。

---

## 2. Design Tokens（实现值）

实现文件：`apps/desktop/src/styles.css` 顶部 `:root`。

### 2.1 色阶语义

| Token | 用途 |
|-------|------|
| `--text-1` / `--text-2` / `--text-3` | 主 / 次 / 辅助文案 |
| `--bg-page` / `--bg-sidebar` / `--bg-main` / `--bg-surface` | 页面 · 侧栏 · 主区 · 卡片面 |
| `--bg-hover` / `--bg-active` / `--bg-input` | 悬停 · 选中 · 输入底 |
| `--border` / `--border-soft` | 描边 |
| `--blue` | 主操作、链接、Tab 指示 |
| `--green` | 成功、启用、running |
| `--accent` | 完全访问、审批强调、>80% 上下文 |
| `--danger` | 终止、拒绝、错误强调 |
| 品牌芯片 | `--claude-*` / `--codex-*` / `--opencode-*` |

业务组件优先用 token；品牌芯片可用登记色。暗色通过 `html[data-theme='dark']` **覆盖同名 token**。

### 2.2 字体

| Token | 实现 | 用途 |
|-------|------|------|
| `--fs-2xs` … `--fs-display` | **11 → 26px**（相对早期线稿整体 +1px） | UI 阶梯 |
| `--fs-base` | **14px** | 默认正文 |
| `--fw-*` | 400 / 500 / 600 / 700 | 禁止非标字重 |
| `--lh-*` | 1.3 / 1.4 / 1.5 / 1.55 | 标题 / 控件 / 正文 / 段落 |
| `--font` / `--mono` | SF Pro / SF Mono 栈 | UI · 路径/model id |

### 2.3 圆角 / 间距 / 控件高

| 类别 | Token | 备注 |
|------|-------|------|
| 圆角 | `--r-xs` 4 → `--r-2xl` 20 + `--r-pill` | 同层级同档；禁止 6/7/9/12 散值 |
| 间距 | `--sp-1`…`--sp-10`（4px 网格） | 表单字段竖向常 `--sp-4` |
| 控件高 | `--h-xs` 24 · `--h-sm` 28 · `--h-md` 32 · `--h-lg` 36 | 表单输入优先 `--h-lg` |
| 阴影 | `--shadow-xs` … `--shadow-lg` · `--shadow-composer` | Composer / 卡片 elevation |

### 2.4 遗留别名

旧规则可继续用映射别名（`--ink`、`--muted`、`--surface` 等），**新代码优先用 v3 语义名**。

---

## 3. 外观（Appearance）

### 3.1 用户四选一

设置 → 常规 → 外观：

| UI 选项 | 内部映射 |
|---------|----------|
| **跟随系统** | `mode=system`，浅色强制 **经典** palette |
| **经典** | `mode=light` + `palette=classic`（冷灰） |
| **深色** | `mode=dark`（palette 在暗色下共用冷暗面） |
| **暖色** | `mode=light` + `palette=warm`（Claude-like 淡橙） |

实现：`ThemeProvider` + `theme-bootstrap.ts`（挂载前写 `data-theme` / `data-palette`，防闪）。  
存储键：`swarmdesk-agent.theme` · `swarmdesk-agent.palette`。

### 3.2 CSS 切换

| 选择器 | 作用 |
|--------|------|
| `:root` | 默认 token（当前默认倾向暖色数值；**系统浅色**启动时 bootstrap 写 classic） |
| `html[data-palette='classic']` | 冷灰浅色 |
| `html[data-palette='warm']` | 暖橙浅色 |
| `html[data-theme='dark']` | 暗色覆盖；暂不拆 warm/classic 两套暗面 |

---

## 4. 全局 Toast（强制）

### 4.1 行为

| 项 | 规范 |
|----|------|
| 组件 | `apps/desktop/src/components/Toast.tsx` · `ToastProvider` |
| 挂载 | `App` 内包裹 `AppShell`（`useToast` 必须在 Provider 内） |
| 定位 | `position: fixed`；水平居中；**`bottom: 33vh`**（窗口下半约 1/3 处） |
| 层级 | `z-index: 10000` |
| 不挡操作 | host `pointer-events: none`；单条 toast 可点关闭 |
| 堆叠 | 自下而上，最多 4 条 |
| 时长 | success/info ≈ 3200ms；error ≈ 4500ms |

### 4.2 样式

- 面：`--bg-surface` + `--border-soft` + `--shadow-lg`
- success / error 用 green / danger 的 soft mix 描边与底
- **不得**改变 shell 高度或插入顶栏占位

### 4.3 使用范围

**必须 Toast：**

- 侦测 Worker 成功/无结果/失败（设置页 + Inspector）
- 设置保存、清 Key、自定义供应商等操作结果
- App 级操作失败（开项目、删会话、切 mode 等；替代 `alert`）

**保持行内 / 持久状态：**

- 表单字段校验（`leaderMaxStepsError`、打开项目路径错误）
- 服务离线 `app-banner`（持续连接态）
- 聊天内错误块、tool 错误、Worker 卡内错误（会话内容）

API：`useToast().success | error | info | toast`。

---

## 5. 对话与过程展示

### 5.1 消息列

- 宽：`max-width: var(--messages-max)` 居中。
- **用户气泡不显示角色「你」**；右对齐蓝色气泡（`--blue-soft` 底，右下圆角缺口）。
- Supervisor（Leader）侧：`.sup-card` 卡片容器（`--bg-surface 72%` 半透明 + `--border-soft` 描边 + `--r-xl` 圆角）。

### 5.2 Supervisor 卡片结构（sup-card）

| 区域 | 类 | 内容 |
|------|-----|------|
| **Header** | `.sup-header` | 头像（18px accent 渐变方块 + `IconSupervisor`）· 名称「Supervisor」· 模型 badge（pill + `IconBolt`，`--bg-hover` 底）· 运行态（绿色脉冲点 + 「运行中」无 `●` 前缀文字，仅 `msgLive` 时） |
| **Body** | `.sup-body` | 思考块 / 工具行 / Worker 行 / 正文 markdown，统一 `gap: 2px` |
| **Footer** | `.sup-footer` | 时长（`IconClock` + mono）· 思考强度（`IconBolt`）· 时间戳（mono）；`border-top` 分隔；`--text-3` 弱化色 |

- 元数据（时长/思考/时间戳）**从 header 下沉到 footer**（header 仅保留模型名 badge）。
- 正文 `.sup-text`：扁平无 bubble 壳（`background: transparent`），`--fs-md` + `line-height: 1.65`。
- 消除旧的 `--leader-content-indent-l/r` 不对称缩进；Body 内统一 gap。
- **运行态文案**：header 用 `chat.runningShort`（无 `●` 前缀，因 `.pip` 已画圆点）；顶部 `chat-head` 服务状态仍用 `chat.running`（保留 `●`）。

### 5.3 节点行（思考 / 工具 / Worker）—— 三组件统一对齐

**核心原则（对齐线稿 `chat-supervisor-redesign.html`）**：
- **三个组件**（`ThinkingBlock` / `ToolCallRow` / `WorkerRunCard`）**保留独立**，但样式 token 严格对齐 `.node-*` 规范。
- **无 card**：无 `border`、无 `shadow`、无卡片底色。纯排版行。
- **图标槽统一 14×14**（`.tb-icon-slot` / `.tr-icon-slot` 同尺寸）。
- **专属图标**（`getToolIcon` 映射）：bash=`terminal-box`、read=`file-text`、edit=`pencil`、write=`file-edit`、grep/glob=`search`、task=`ai-agent`、fetch/web=`globe`、git=`branch`、fallback=`wrench`。
- **图标始终静态**：不 spin。运行态靠 BusyDots（三点脉冲）+ live duration 计时 + `opacity: 0.7` 变暗。
- **label 统一**：`--fs-xs`(11px) `--fw-medium` `--text-3`（次级色）。
- **chevron 旋转**（非两个独立图标交叉淡入）：单 `ChevronIcon`，`transform: rotate(90deg)` 过渡当展开。三者一致。
- **展开体统一**：缩进（`padding: 2px 0 4px 12px`）+ `border-left: 2px solid color-mix(--border 70%, --text-3)` 竖线 guide + `--fs-2xs` mono 文本。**不再是终端卡片**（无 bg/border/radius）。

| 节点 | 图标 | 展开内容 |
|------|------|---------|
| 思考 | `brain` | reasoning text |
| bash/shell | `terminal-box` | `$ command` + stdout/stderr（纯文本行 + 竖线） |
| edit/str_replace | `pencil` | （工具通用展开体） |
| read/view | `file-text` | （工具通用展开体） |
| write/create | `file-edit` | （工具通用展开体） |
| grep/glob/search | `search` | （工具通用展开体） |
| fetch/web | `globe` | （工具通用展开体） |
| task/agent | `ai-agent` | （工具通用展开体） |
| delete/remove | `trash` | （工具通用展开体） |
| move/rename | `move` | （工具通用展开体） |
| getActiveContextTool | `info` | （工具通用展开体） |
| listWorkersTool | `workers` | （工具通用展开体） |
| listProjectsTool | `folder` | （工具通用展开体） |
| *Job* (get/list/cancel) | `clock` | （工具通用展开体） |
| dispatchWorkerTool | **合并节点**（见 §5.4） | — |
| Worker（独立 live 卡） | 品牌 logo（16px） | 输出/权限/审批 |

**图标映射规则**：`getToolIcon` 用 `includes` 语义（非 `^` 锚定），适配两种工具名风格——lowercase CLI 工具（bash/read/edit…）和 PascalCase + Tool 后缀的 router 自有工具（dispatchWorkerTool 等）。匹配顺序：先 router 自有（更具体），再 CLI，最后 `IconWrench` fallback。

**工具行展开态**：折叠时右侧显示命令预览（`.tool-row-cmd`）；**展开时隐藏**（避免与展开体重复）。

### 5.4 节点展开体（`.node-body-inner` + `.line` 流）

**思考 / 工具 / Worker 三者共用线稿 `.node-body-inner`**：缩进（`margin-left:8px; padding:4px 0 6px 14px`）+ 1px 竖线 guide（`::before`）+ 内部 `.line` 事件流。不再是面板/卡片/终端块。

每行 `.line` 结构（线稿原文 1:1）：
```html
<div class="line"><span class="mk">▸</span><span class="tx">动作描述</span></div>
```
- `.mk`：标记符号（`▸` 进行中 / `✓` 完成 / `$` 命令 / `✗` 错误），`--text-4` 色；`.line.ok .mk` 用 `--green`；`.mk.err` 用 `--danger`
- `.tx`：文本，mono `--fs-2xs`，`--text-3` 色；内嵌 `<code>` 用 `--bg-input` 底
- `.line`：`display:flex; gap:var(--sp-2); line-height:1.7`

**工具节点 `.line` 映射**（ToolCallRow）：
- command → `$ {command}`
- stdout 每行 → `▸ {line}`
- stderr 每行 → `✗ {line}`（mk.err danger 色）
- 完成态 → `✓ done`（line.ok）

**Worker 节点 `.line` 映射**（WorkerRunCard，dispatch 合并场景）：
- `input.task`（dispatch 提示词）→ `▸ {task}`
- pending approval → `▸ {toolKind · title · path}`
- error → `✗ {error}` + 认证/重置按钮（mk.err）
- output completed → `✓ {markdown reply}`（line.ok，`.tx` 放宽为 block 容纳 markdown）
- running 无输出 → `▸ {运行中}`

**dispatchWorkerTool 合并**：dispatch 工具调用与其触发的 worker run 合并为单个 `WorkerRunCard`（`taskPrompt` prop），不再平级渲染 `[tool-row + worker-card]`。判定：`/dispatch/i.test(name) && input.task 是字符串 && 有 cardPlacement`。默认折叠，运行中自动展开。

**Worker 行 head**（`.worker-card-head`，与 `.node-row` 共用）：
- Logo 16px；品牌色 token 覆盖（claude/codex/opencode/cc/cx/oc）。
- name `--text-2`；运行中追加 `busy-dots` + `opacity:0.7`。
- **access pill**（`.node-cap`）：session 级访问模式（`accessModeId` prop）。配色：`confirm`/`plan`=warn，`auto_edit`/`full_access`=danger。
- **chevron**：head 末尾旋转 chevron（`.worker-chevron`，受控 14×14），`rotate(90deg)` 当 is-open。
- status mono `--fs-2xs` tabular。
- 审批按钮紧凑化（`approval-row` + `ApprovalActions`）。
- 折叠动画：`useCollapsible`（JS Web Animations API，与思考/工具统一）。

> **未实现（数据缺失）**：
> - `node-dur` token 计数（`2.1k tok`）——`WorkerRunState` 无 token 字段。
> - per-worker diff-stat（`+48 −12`）——无 per-run 数据，repo-global 已在 RightPanel。
> - Worker 思考过程段 / 子工具调用历史段——`WorkerRunState` 无 `reasoningText` / `toolCallHistory` 字段。线稿 `.line` 流已预留位置，后端补字段后直接填入。

### 5.5 Markdown 渲染（sup-text）

- 标题 **em 相对尺寸**：h1=`1.125em` / h2=`1.0625em` / h3=`1em` + accent 色阶（h1 100% → h3 80%）。
- 段落间距 `0.65em`，末段 `margin: 0`。
- 行内 code 底色 `--bg-input`（从 `--accent-soft` 弱化）。
- 无序列表 **en-dash `–` 标记**（替代原生 disc）。
- 代码块：`--bg-input` 底 + `--border-soft` 描边 + `--r-md` 圆角。

### 5.6 Composer

- elevated 卡片；访问模式合一菜单；上下文环；模型+思考；发送/终止。
- **若产品声明锁定 Composer，后续 PR 勿擅自改结构**（本规范只约束其 token 与访问模式语义）。

访问模式选项语义：变更前确认 · 自动编辑 · 计划模式 · **完全访问**（橙色强调）。

---

## 6. 设置页

### 6.1 导航四项（仅此）

| 导航 | 内容 |
|------|------|
| 常规 | 外观四选一、语言、Leader 最大步骤 |
| 模型设置 | 供应商轨 · 模型列表 · Key · 启用 |
| AgentWorker | 已注册 CLI · 侦测 · 注册 |
| 关于 | 产品名 / 版本 / 说明 |

顶栏：「← 返回工作区」。入口唯一：侧栏设置。

### 6.2 模型设置要点

- **已启用**：纯 knob（`.enable-switch` / `.enable-switch-knob`），**无「已启用」文案**贴开关。
- **Base URL + 接口类型**：combo 字段（类型分段 + URL），与线稿一致。
- Hint **永远在控件下方**。
- 自定义模型：上下文窗口支持 `20K` / `1M` 等简写（`context-window.ts`）。

### 6.3 AgentWorker

- 列表：logo · 名 · 状态 · 命令摘要 · 角色 · **toggle 启用** · 健康
- 侦测结果：**只 Toast**，不在列表上方插 success banner
- 注册表单：ACP Registry 可搜索下拉框 · 名称 · CLI · 参数 · 主角色 · 兼角色 · 启用
- 选择 Registry Agent 后自动填充可编辑的命令、参数、非敏感 env 与描述；binary Agent 明确提示需本机安装，Registry 网络失败时仍保留手工注册。

### 6.4 开关控件

| 类 | 用途 |
|----|------|
| `.toggle` / `.toggle.off` | Worker 启用等胶囊开关 |
| `.enable-switch` | 供应商「已启用」纯圆钮 + 滑块动画 |

---

## 7. 组件与文件地图

| 区域 | 路径 |
|------|------|
| Token / 全局样式 | `apps/desktop/src/styles.css` |
| 主题 / 色板 | `theme/ThemeProvider.tsx` · `theme-bootstrap.ts` |
| Toast | `components/Toast.tsx` |
| 设置全页 | `components/SettingsPanel.tsx` |
| Inspector | `components/RightPanel.tsx` |
| 对话 | `components/ChatPanel.tsx` · `WorkerRunCard.tsx` |
| 图标 | `components/Icons.tsx` · `lib/provider-icons` |
| 壳 | `App.tsx`（`ToastProvider` · 双壳切换） |
| 文案 | `i18n/locales.ts` |

---

## 8. 禁止事项（Review 清单）

- [ ] 不在 `design/` 提交线稿、截图、token 草稿
- [ ] 不新增顶栏 / 行内 **操作结果** 条（改用 Toast）
- [ ] 不永久三栏挤压主对话
- [ ] 不用 emoji 当功能图标
- [ ] 不硬编码未登记色值改整屏观感（先扩 token）
- [ ] 不恢复 Inspector「Jobs」Tab（除非产品重新立项）
- [ ] 不在用户气泡恢复「你」角色标签
- [ ] 系统浅色不得默认成暖色（跟随系统 = 经典）
- [ ] 不自绘更小的左上三键；用系统原生 traffic lights + Electron≥42；标题带 52px（§1.3）
- [ ] **节点行（思考/工具/Worker）禁止 border/shadow/卡片底色**——纯排版行
- [ ] **工具图标禁止 spin/旋转**——始终静态；运行态靠 BusyDots + 计时 + opacity

---

## 9. 与意图稿差异摘要

相对 `2026-07-16-desktop-ui-redesign-design.md` 线稿意图，**实现已采纳**：

| 项 | 意图稿 | As-built |
|----|--------|----------|
| 字号基准 | base 13px | base **14px**（整体 +1） |
| 侧栏宽 | 256 | **232** |
| 外观 | 系统/浅/深 | **系统/经典/深色/暖色** |
| 默认浅色 | 冷灰 | 系统→经典；显式暖色可选 |
| Inspector Tabs | 含 Jobs | **无 Jobs** |
| 用户角色 | 可有「你」 | **无「你」** |
| 操作反馈 | 未统一 | **全局 Toast @ 下 1/3** |
| 启用开关 | 文案+开关 | **纯 knob**（供应商） |
| 左上三键 | 线稿假圆点 | **系统原生** + Electron≥42 + 52px 标题带（§1.3） |

后续改 UI：优先改代码与**本文**；本地线稿仅作对照，不入库。
