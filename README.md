# SwarmDesk

**EN** · [中文](#swarmdesk-中文)

Desktop multi-agent command center: a **Mastra Supervisor** Leader coordinates local **ACP** coding agents (Claude Code, Codex, OpenCode, and agents from the ACP Registry) against your project.

---

## English

### What it is

SwarmDesk is a local desktop app (macOS / Windows / Linux) that lets you:

- Chat with a **Leader** model that plans and delegates work
- Run real coding agents on your machine over **ACP** (Agent Client Protocol)
- Approve tool calls, watch worker progress, and keep sessions across restarts
- Open a project path, inspect git/files, and manage models & API keys in Settings

Agents run as **your OS user** (not a hard sandbox). Installers ship the UI + local API runtime; **ACP agent CLIs are not bundled** — install and sign in to each agent you want to use.

### Download

Get prebuilt binaries from **[GitHub Releases](https://github.com/xun404/swarmdesk-agent/releases)**. Prefer the latest `v*` release and verify `SHA256SUMS` when present.

| Platform | Architecture          | Packages      |
| -------- | --------------------- | ------------- |
| macOS    | Apple Silicon (arm64) | DMG, ZIP      |
| Windows  | x64                   | NSIS EXE      |
| Linux    | x64                   | AppImage, DEB |

Installers are currently **unsigned** (no macOS notarization / Windows code signing). Gatekeeper or SmartScreen may warn; download only from this repo’s Releases.

```bash
# macOS / Linux — in the folder that contains SHA256SUMS and the installer
shasum -a 256 -c SHA256SUMS

# Windows PowerShell
Get-FileHash .\SwarmDesk-Agent-0.1.0-win-x64.exe -Algorithm SHA256
```

After install: open the app → configure Leader API keys in **Settings** → open a project → register workers (built-in presets or Registry) → chat.

### Supported agents (Workers)

#### Built-in presets

| Agent           | Role focus                        | Notes                                       |
| --------------- | --------------------------------- | ------------------------------------------- |
| **Claude Code** | coder (+ plan, research, general) | Via `@agentclientprotocol/claude-agent-acp` |
| **Codex CLI**   | review (+ coder, test, general)   | Via `@zed-industries/codex-acp`             |
| **OpenCode**    | general (+ coder, plan, test)     | Native `opencode acp`                       |

Worker roles used for delegation: `plan` · `coder` · `review` · `test` · `research` · `general`.

#### ACP Registry (bundled catalog)

The app also discovers agents from the official ACP Registry (bundled offline snapshot + optional refresh). Names currently included:

Agoragentic · Amp · Auggie CLI · Autohand Code · Claude Agent · Cline · Codebuddy Code · Codex · Cortex Code · Corust Agent · crow-cli · Cursor · DeepAgents · Devin · DimCode · Dirac · Factory Droid · fast-agent · Gemini CLI · GitHub Copilot · GLM Agent · goose · Grok Build · Harn · Junie · Kilo · Kimi CLI · Minion Code · Mistral Vibe · Nova · OpenCode · pi ACP · Poolside · Qoder CLI · Qwen Code · siGit Code · Stakpak · VT Code

Registry agents need an explicit **prepare → trust → authenticate** flow before dispatch. Availability depends on platform, install method (`npx` / `uvx` / binary), and each agent’s own login.

### Leader models & provider APIs

The Leader uses Mastra’s model router (`provider/model`). Configure keys and models in **Settings** (encrypted on disk).

#### Built-in providers

| Provider        | API style            | Typical env key                                   |
| --------------- | -------------------- | ------------------------------------------------- |
| OpenAI          | OpenAI               | `OPENAI_API_KEY`                                  |
| Anthropic       | Anthropic Messages   | `ANTHROPIC_API_KEY`                               |
| Google (Gemini) | Google Generative AI | `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY` |
| xAI (Grok)      | OpenAI-compatible    | `XAI_API_KEY`                                     |
| DeepSeek        | OpenAI-compatible    | `DEEPSEEK_API_KEY`                                |

#### Custom / gateway APIs

| Style                    | Use for                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **OpenAI-compatible**    | OpenRouter, Ollama, SiliconFlow, Azure OpenAI-compatible gateways, many local/proxy endpoints (`baseURL` + API key) |
| **Anthropic-compatible** | Anthropic-protocol proxies                                                                                          |
| **Google-compatible**    | Gemini-style endpoints                                                                                              |
| **Custom**               | Other gateways mapped in Settings (id + base URL + key env)                                                         |

Mastra may also resolve additional registry providers (e.g. aliases for OpenCode Zen/Go, Bedrock, OpenRouter) when configured correctly.

### Platform notes

- **UI language**: Chinese / English in the title bar
- **Data**: local under `~/.config/swarmdesk-agent/` (settings, encrypted secrets, sessions)
- **License**: [MIT](./LICENSE)
- **Contributing / maintainers**: see [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/HANDOVER.md](./docs/HANDOVER.md)

---

## SwarmDesk (中文)

**[EN](#swarmdesk-agent)** · **中文**

桌面端多智能体指挥台：由 **Mastra Supervisor（Leader）** 规划与委派，通过 **ACP** 调度本机编码 Agent（Claude Code / Codex / OpenCode 及 ACP Registry 中的 Agent）在本地项目上执行任务。

---

### 它是什么

SwarmDesk 是 macOS / Windows / Linux 本地桌面应用，可以：

- 与 **Leader** 模型对话，由它规划并委派任务
- 通过 **ACP（Agent Client Protocol）** 调用本机真实编码 Agent
- 审批工具调用、查看 Worker 进度，并在重启后恢复会话上下文
- 打开本地项目路径，查看 Git / 文件，在设置中管理模型与 API Key

Agent 以**当前系统用户权限**运行（非强沙箱）。安装包包含 UI 与本地 API runtime，**不内置各 Agent CLI**——使用前请自行安装并登录对应 Agent。

### 下载

请从 **[GitHub Releases](https://github.com/xun404/swarmdesk-agent/releases)** 下载预编译安装包。建议使用最新 `v*` 版本，并核对同目录 `SHA256SUMS`。

| 系统    | 架构                   | 安装包        |
| ------- | ---------------------- | ------------- |
| macOS   | Apple Silicon（arm64） | DMG、ZIP      |
| Windows | x64                    | NSIS EXE      |
| Linux   | x64                    | AppImage、DEB |

当前安装包**未代码签名 / 未 notarize**。macOS Gatekeeper 或 Windows SmartScreen 可能提示未知来源；请仅从本仓库 Releases 下载。

```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS

# Windows PowerShell
Get-FileHash .\SwarmDesk-Agent-0.1.0-win-x64.exe -Algorithm SHA256
```

安装后：打开应用 → **设置**中配置 Leader 的 API Key → 打开项目 → 注册 Worker（内置预设或 Registry）→ 开始对话。

### 支持的 Agent（Worker）

#### 内置预设

| Agent           | 主角色侧重                            | 说明                                    |
| --------------- | ------------------------------------- | --------------------------------------- |
| **Claude Code** | coder（兼 plan / research / general） | `@agentclientprotocol/claude-agent-acp` |
| **Codex CLI**   | review（兼 coder / test / general）   | `@zed-industries/codex-acp`             |
| **OpenCode**    | general（兼 coder / plan / test）     | 原生 `opencode acp`                     |

委派角色：`plan` · `coder` · `review` · `test` · `research` · `general`。

#### ACP Registry（安装包内置目录快照）

还可从官方 ACP Registry 发现并准备 Agent（离线 bundled 快照 + 可选更新）。当前收录名称包括：

Agoragentic · Amp · Auggie CLI · Autohand Code · Claude Agent · Cline · Codebuddy Code · Codex · Cortex Code · Corust Agent · crow-cli · Cursor · DeepAgents · Devin · DimCode · Dirac · Factory Droid · fast-agent · Gemini CLI · GitHub Copilot · GLM Agent · goose · Grok Build · Harn · Junie · Kilo · Kimi CLI · Minion Code · Mistral Vibe · Nova · OpenCode · pi ACP · Poolside · Qoder CLI · Qwen Code · siGit Code · Stakpak · VT Code

Registry Agent 需完成 **准备 → 信任确认 → 认证** 后才能派发；是否可用取决于平台、安装方式（`npx` / `uvx` / binary）及各 Agent 自身登录要求。

### Leader 模型与服务商接口

Leader 使用 Mastra 模型路由（`provider/model`）。在 **设置** 中配置密钥与模型（本地加密存储）。

#### 内置服务商

| 服务商           | 接口类型             | 常用环境变量 / 密钥名                             |
| ---------------- | -------------------- | ------------------------------------------------- |
| OpenAI           | OpenAI               | `OPENAI_API_KEY`                                  |
| Anthropic        | Anthropic Messages   | `ANTHROPIC_API_KEY`                               |
| Google（Gemini） | Google Generative AI | `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY` |
| xAI（Grok）      | OpenAI 兼容          | `XAI_API_KEY`                                     |
| DeepSeek         | OpenAI 兼容          | `DEEPSEEK_API_KEY`                                |

#### 自定义 / 网关接口

| 接口类型           | 典型用途                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------- |
| **OpenAI 兼容**    | OpenRouter、Ollama、硅基流动、Azure OpenAI 兼容网关、各类本地/代理端点（`baseURL` + API Key） |
| **Anthropic 兼容** | Anthropic 协议代理                                                                            |
| **Google 兼容**    | Gemini 风格端点                                                                               |
| **Custom**         | 在设置中配置 id、base URL 与密钥环境变量的其他网关                                            |

在正确配置时，还可对接 Mastra 注册表中的其他 provider（如 OpenCode Zen/Go、Bedrock、OpenRouter 等别名）。

### 其他说明

- **界面语言**：标题栏可切换中文 / English
- **本地数据**：`~/.config/swarmdesk-agent/`（配置、加密密钥、会话等）
- **许可证**：[MIT](./LICENSE)
- **贡献与交接**：[CONTRIBUTING.md](./CONTRIBUTING.md)、[docs/HANDOVER.md](./docs/HANDOVER.md)
