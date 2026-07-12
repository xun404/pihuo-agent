# Router Agents — GUI 线框 / 高保真

交互式桌面 GUI 原型，覆盖 **Project / Session · Chat · Workers / Git / Files** 三栏布局，风格参考 Codex Desktop。

## 打开方式

```bash
# 在浏览器中打开
open design/gui/index.html

# 或用本地静态服务
npx serve design/gui
```

推荐使用 Chrome / Safari，窗口宽度 ≥ 1200px 以获得完整三栏观感。

## 顶部控件

| 控件 | 说明 |
|------|------|
| **高保真 / 线框** | 深色产品视觉 ↔ 浅色标注线框（含区域标签与设计注释） |
| **空态** | 未选 Project 的 onboarding |
| **活跃会话** | Leader 计划 + 委派卡片 + Diff + Composer |
| **权限审批** | ACP permission 弹窗 + 行内审批卡 + Approvals 队列 |
| **Worker 注册** | 右栏注册表单展开 |

### 快捷键

| 键 | 动作 |
|----|------|
| `1` / `2` / `3` / `4` | 空态 / 活跃 / 审批 / Workers |
| `W` | 切换线框 ↔ 高保真 |

## 布局说明

```
┌────────────┬──────────────────────────┬─────────────────┐
│ LEFT       │ CENTER                   │ RIGHT           │
│ Projects   │ Session toolbar + modes  │ Workers         │
│ Sessions   │ Chat timeline            │ Git / Files     │
│            │ Composer                 │ Approvals       │
│            │                          │ Activity        │
└────────────┴──────────────────────────┴─────────────────┘
```

### 左栏

- Project 树：路径、分支徽标
- Session 列表：状态点（running / needs_approval / idle）
- 搜索、新建 Session

### 中栏（Codex 风格）

- Mode：Ask / Plan / Build / Review
- 结构化消息：气泡 + Plan 卡 + Delegate 卡 + Diff 卡 + Approval 卡
- Composer：`@file`、mode、Workers 限制、Stop、发送

### 右栏

| Tab | 内容 |
|-----|------|
| Workers | ACP CLI 注册、健康状态、能力标签、启用开关 |
| Git | +/- 统计、变更文件、Commit |
| Files | 项目树 |
| Approvals | 待批权限队列 |
| Activity | 委派时间线 / tokens |

## 设计决策（摘要）

1. **三栏固定**，中间 Chat 为焦点；左右可后续做成可折叠。
2. **委派可视化**：Worker 不是黑盒，用左侧色条 + badge 表示 running/done。
3. **审批双入口**：行内卡片（不打断上下文）+ Modal（高风险）+ 右栏队列。
4. **Leader vs Worker 视觉区分**：Leader 用蓝 badge，delegate 用紫，artifact 用橙。
5. **macOS 窗口壳**：Traffic lights + 标题栏，便于评估 Electron 成稿尺寸。

## 文件

| 文件 | 用途 |
|------|------|
| `index.html` | 结构与四种状态内容 |
| `styles.css` | 设计系统 + 线框/高保真主题 |
| `app.js` | 状态切换与轻交互 |
| `README.md` | 本说明 |

## 下一步

- 与工程对齐组件命名（`SessionList` / `DelegationCard` / `WorkerRegistry`）
- 可选：导出关键帧为 PNG 放进设计文档
- Phase 0：用 Electron + Mastra 实现本壳的真实数据绑定
