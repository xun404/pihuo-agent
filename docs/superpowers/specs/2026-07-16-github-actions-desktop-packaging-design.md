# GitHub Actions 桌面打包与开源初始化设计

**状态：** 已批准  
**日期：** 2026-07-16  
**范围：** `swarmdesk-agent` 正式项目；不包含实验验证 Demo `agents-router`

## 1. 目标

为 SwarmDesk 建立可公开发布的桌面应用交付基础：

1. Electron 安装包脱离源码仓库和系统 Node.js 后仍可启动内置 Mastra API。
2. GitHub Actions 在 Pull Request、`main` 和 `v*` 标签上完成一致的测试、构建与打包。
3. `v*` 标签只有在 macOS、Windows、Linux 全部成功后才创建完整 GitHub Release。
4. 首版允许无签名发布，同时为后续 macOS 签名/公证和 Windows 签名保留清晰入口。
5. 补齐最小开源基础文件和公开发布说明。

## 2. 已确认的发布决策

| 项目         | 决策                                                     |
| ------------ | -------------------------------------------------------- |
| 产品名       | `SwarmDesk`                                          |
| 应用 ID      | `net.rmbz.open-dev.agent-desktop`                        |
| 作者/维护者  | `xun404 <xun404@users.noreply.github.com>`               |
| 许可证       | MIT，Copyright 2026 xun404                               |
| macOS        | Apple Silicon arm64；DMG + ZIP                           |
| Windows      | x64；NSIS `.exe`                                         |
| Linux        | x64；AppImage + deb                                      |
| PR / main    | 测试、构建、打包、短期 Artifact                          |
| 正式发布     | `v*` 标签，标签必须与根 `package.json` 版本一致          |
| 签名         | 首版无签名，预留 Secrets 和配置入口                      |
| 应用内更新   | 首版不启用；保留 electron-builder 发布元数据             |
| 应用图标     | 首版允许使用 Electron 默认图标；正式品牌图标后续单独设计 |
| 外部运行条件 | 应用自带 API runtime；ACP Agent CLI 由用户安装或配置     |

## 3. 当前阻塞

当前 Electron 主进程从仓库源码启动 API：

- 通过相对路径查找 `packages/mastra-app/src/http-server.ts`；
- 调用系统 `node --import tsx`；
- 使用仓库根目录作为运行身份；
- 假设 workspace 源码和依赖都存在。

因此，现有 `npm run build` 只能生成 Electron production entry，不能生成可交付给普通用户的独立应用。只增加 electron-builder 配置会得到无法启动内置 API 的安装包。

## 4. 可分发 Runtime 架构

### 4.1 生产 Runtime

新增独立 Desktop API runtime 构建：

```text
packages/mastra-app/src/http-server.ts
  + packages/core
  + packages/adapters
  + packages/shared
  + JavaScript dependencies
           │
           ▼
apps/desktop/dist-runtime/http-server.mjs
```

应用代码和纯 JavaScript 依赖编译为生产 JavaScript，不把 TypeScript 源码或 `tsx` 作为安装后的运行条件。

`libsql` 及其当前平台原生二进制保留为显式 runtime 外部依赖，放在与入口相邻的：

```text
resources/runtime/
  http-server.mjs
  node_modules/
    libsql/
    @libsql/
    @neon-rs/
    detect-libc/
```

该目录通过 electron-builder `extraResources` 分发，不进入 ASAR。每个平台在自己的原生 GitHub Runner 上安装并校验对应二进制，避免跨平台原生模块错误。

### 4.2 API 子进程

Electron 官方 `utilityProcess.fork()` 提供带 Node.js 的独立子进程。打包态使用：

```text
utilityProcess.fork(
  process.resourcesPath/runtime/http-server.mjs
)
```

开发态继续使用现有 `node --import tsx` 启动源码入口，以免每次开发启动都强制预编译 runtime。

当前 API 生命周期逻辑抽象为最小 process adapter：

- `pid`
- `stdout` / `stderr`
- `kill()`
- `spawn` / `exit` / `error`

开发态 `ChildProcess` 和打包态 `UtilityProcess` 通过同一上层启动、ready、重启、退出等待逻辑运行。现有 runtime discovery、desktop token、owner epoch 和 API 身份校验必须保留。

参考：[Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)

### 4.3 打包态身份与路径

打包态不得再推导 `REPO_ROOT`。Electron 主进程向 API 传入稳定的应用身份根，来源为 `app.getPath('userData')`，用于：

- 计算 API workspace identity；
- 防止复用其他 SwarmDesk 实例的 runtime discovery；
- 在版本升级后保持相同应用身份。

它不替代用户项目路径。用户打开的代码项目仍以其真实绝对路径存入 LocalStore，并作为 ACP Worker cwd。

开发态继续使用仓库根作为身份根，保留当前多 checkout 隔离行为。

## 5. electron-builder 配置

引入直接开发依赖 `electron-builder@26.15.3`，使用根目录 `electron-builder.yml`：

```yaml
appId: net.rmbz.open-dev.agent-desktop
productName: SwarmDesk
```

构建配置只包含运行必需内容：

- `apps/desktop/dist`
- `apps/desktop/dist-electron`
- 应用 package metadata
- `resources/runtime`

目标：

| 平台    | Runner         | 架构  | 目标              |
| ------- | -------------- | ----- | ----------------- |
| macOS   | `macos-15`     | arm64 | `dmg`, `zip`      |
| Windows | `windows-2025` | x64   | `nsis`            |
| Linux   | `ubuntu-24.04` | x64   | `AppImage`, `deb` |

Artifact 名称包含产品、版本、平台和架构，避免不同矩阵任务覆盖同名文件。

首版显式关闭证书自动发现。后续签名只允许通过 GitHub Actions Secrets 注入，不把证书、密码或 Apple 凭据写入仓库。

参考：

- [electron-builder GitHub Actions](https://www.electron.build/docs/features/github-actions/)
- [electron-builder Targets](https://www.electron.build/docs/targets/)
- [electron-builder Multi Platform Build](https://www.electron.build/docs/features/multi-platform-build/)

## 6. GitHub Actions

### 6.1 CI 工作流

`.github/workflows/ci.yml` 触发条件：

- `pull_request`
- push 到 `main`

权限默认为：

```yaml
permissions:
  contents: read
```

阶段：

1. Ubuntu 质量门：`npm ci`、`npm test`、`npm run typecheck`、`npm run build`。
2. 三平台打包矩阵：原生安装依赖、构建 runtime、electron-builder `--dir`、packaged smoke、生成安装包。
3. 上传短期 Actions Artifact，便于 PR 和主分支人工下载验证。

使用 concurrency 取消同一 PR 或分支的过时运行，避免重复消耗 Runner。

### 6.2 Release 工作流

`.github/workflows/release.yml` 触发条件：

- push `v*` 标签；
- 带明确 tag 输入的 `workflow_dispatch`，用于失败后的人工恢复。

发布前必须校验：

```text
git tag = v + 根 package.json version
```

三平台构建任务只拥有 `contents: read`，各自上传 Artifact。只有全部构建成功后，汇总 job 才获得：

```yaml
permissions:
  contents: write
```

汇总 job：

1. 下载全部平台 Artifact；
2. 校验预期扩展名和平台集合完整；
3. 为所有发布文件生成 `SHA256SUMS.txt`；
4. 使用 Runner 自带 `gh` 创建或恢复目标 GitHub Release；
5. 上传全部产物和 checksum；
6. 使用 GitHub 自动生成 release notes。

不使用第三方 Release Action，Fork PR 不接触 Secrets，单个平台失败时不创建部分 Release。

参考：

- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
- [GitHub GITHUB_TOKEN](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)

## 7. Packaged Smoke

新增隐藏参数 `--packaged-smoke`，仅用于打包验收：

1. Electron 到达 `ready`；
2. 不创建 BrowserWindow；
3. 从 `process.resourcesPath/runtime` 启动真实 UtilityProcess API；
4. 等待 `/health`；
5. 校验 pid、owner epoch、workspace identity、runtime discovery 和 desktop token 握手；
6. 正常终止 API 并退出 0。

以下情况必须退出非 0：

- runtime 入口缺失；
- 原生 runtime 依赖缺失或加载失败；
- API 在 ready 前退出；
- `/health` 超时；
- discovery/health 身份不匹配；
- API 无法被安全停止。

Actions 从 electron-builder 的 unpacked 应用目录执行该 smoke：

- macOS：`.app/Contents/MacOS/SwarmDesk --packaged-smoke`
- Windows：unpacked `.exe --packaged-smoke`
- Linux：`xvfb-run` 下执行 unpacked AppRun 或主二进制

这验证真实安装内容，而不是只检查文件名。

## 8. 测试与静态验证

### 8.1 单元测试

覆盖：

- 开发态和打包态 runtime 路径；
- 稳定应用身份根；
- ChildProcess / UtilityProcess adapter 状态映射；
- 启动失败、提前退出、正常停止、超时升级；
- smoke 参数不会创建窗口；
- 原有 API ownership/token 校验不退化。

### 8.2 Runtime 构建检查

构建后脚本必须验证：

- `http-server.mjs` 存在；
- 生产入口没有 `.ts` import；
- 生产入口没有 `@swarmdesk-agent/*` 源码 workspace import；
- runtime 原生依赖目录完整；
- package version、Electron metadata 与 Release tag 一致；
- `git diff --check` 通过。

### 8.3 完整验收

本地可执行范围：

```bash
npm test
npm run typecheck
npm run build
npm run package:dir
npm run smoke:packaged
```

最终三平台安装包以 GitHub Actions 原生 Runner 结果为准。macOS arm64 本地还应完成一次 unpacked smoke 和 DMG 挂载启动检查。

## 9. 开源基础文件

新增：

- `LICENSE`：标准 MIT 文本，Copyright 2026 xun404；
- `SECURITY.md`：要求通过 GitHub Private Vulnerability Reporting 私下报告，不在公开 Issue 披露；
- `CONTRIBUTING.md`：Node.js `>=22.13.0`、npm 安装、测试、构建、打包、PR 和 Secrets 规则。

更新：

- `README.md`：Downloads/Release、平台产物、ACP CLI 前置条件、无签名警告和源码构建；
- `docs/HANDOVER.md`：发布架构、Actions、后续签名 Secrets、验证结果与剩余风险。

## 10. 错误处理与发布安全

- runtime 构建或 native dependency 准备失败时禁止进入 electron-builder。
- packaged smoke 失败时不上传可发布 Artifact。
- Release 汇总缺少任意平台或任意目标格式时失败。
- 标签版本不匹配时失败，不自动修改版本或标签。
- 首版发布说明明确：
  - macOS 未签名，Gatekeeper 会提示；
  - Windows 未签名，SmartScreen 可能提示；
  - 安装包不包含第三方 ACP Agent CLI；
  - API key 仍只写入本机加密存储。
- 后续签名必须使用 GitHub Environments/Secrets，且签名 job 不在 Fork PR 运行。

## 11. 非目标

本轮不包含：

- Intel macOS；
- Windows arm64 或 Linux arm64；
- Apple Developer ID 申请、macOS 公证和 Windows 证书采购；
- Mac App Store、Microsoft Store、Snap Store 或 Flatpak 发布；
- 应用内自动更新 UI 与自动安装；
- 正式品牌应用图标与各平台图标资产；
- Issue/PR 模板、Code of Conduct 或完整社区治理；
- 自动版本递增或 semantic-release；
- 捆绑 Claude Code、Codex、OpenCode 或其他 ACP Agent CLI。

## 12. 验收标准

1. PR 和 `main` Actions 能在三平台生成所需安装包并上传 Artifact。
2. `v<package-version>` 标签在三平台全部成功后生成单一完整 GitHub Release。
3. Release 包含 DMG、macOS ZIP、NSIS、AppImage、deb 和 `SHA256SUMS.txt`。
4. macOS 仅生成 arm64 产物；Windows/Linux 生成 x64 产物。
5. Packaged smoke 在三平台证明应用不依赖源码仓库、系统 Node 或 `tsx`。
6. API owner/discovery/token 安全边界保持现有行为。
7. 无签名环境可以构建；文档明确平台警告和后续签名入口。
8. `LICENSE`、`SECURITY.md`、`CONTRIBUTING.md` 和发布文档完整。
