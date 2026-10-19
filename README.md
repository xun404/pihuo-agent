<h1 align="center">
  <a href="https://github.com/xun404/pihuo-agent">Pi活儿</a>
</h1>

<p align="center">
  <a href="https://github.com/xun404/pihuo-agent/stargazers"><img src="https://img.shields.io/github/stars/xun404/pihuo-agent?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/xun404/pihuo-agent/blob/main/LICENSE"><img src="https://img.shields.io/github/license/xun404/pihuo-agent" alt="License" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="macOS · Windows · Linux" />
</p>

<p align="center">
  <sub><a href="docs/readme/README.en.md">English</a></sub>
</p>

<p align="center">
  <strong>Pi活儿：你说要干什么，Pi 拆开派出去，本机 Worker 接着干。</strong>
</p>

<p align="center">
  <img src="docs/assets/readme-hero.png" alt="Pi活儿 桌面界面" width="960" />
</p>

## 支持的 Agent

内置预设 + **ACP Registry**。Registry 是否可用取决于平台、安装方式（`npx` / `uvx` / binary）及各 Agent 登录。安装包**不内置** Agent CLI。

### 内置预设

| Agent           | 主角色  | 兼角色                  |
| --------------- | ------- | ----------------------- |
| **Claude Code** | coder   | plan, research, general |
| **Codex CLI**   | review  | coder, test, general    |
| **OpenCode**    | general | coder, plan, test       |

### ACP Registry（安装包内目录）

<p>
  <kbd>Agoragentic</kbd> <kbd>Amp</kbd> <kbd>Auggie CLI</kbd> <kbd>Autohand Code</kbd> <kbd>Claude Agent</kbd><br>
  <kbd>Cline</kbd> <kbd>Codebuddy Code</kbd> <kbd>Codex</kbd> <kbd>Cortex Code</kbd> <kbd>Corust Agent</kbd><br>
  <kbd>crow-cli</kbd> <kbd>Cursor</kbd> <kbd>DeepAgents</kbd> <kbd>Devin</kbd> <kbd>DimCode</kbd><br>
  <kbd>Dirac</kbd> <kbd>Factory Droid</kbd> <kbd>fast-agent</kbd> <kbd>Gemini CLI</kbd> <kbd>GitHub Copilot</kbd><br>
  <kbd>GLM Agent</kbd> <kbd>goose</kbd> <kbd>Grok Build</kbd> <kbd>Harn</kbd> <kbd>Junie</kbd><br>
  <kbd>Kilo</kbd> <kbd>Kimi CLI</kbd> <kbd>Minion Code</kbd> <kbd>Mistral Vibe</kbd> <kbd>Nova</kbd><br>
  <kbd>OpenCode</kbd> <kbd>pi ACP</kbd> <kbd>Poolside</kbd> <kbd>Qoder CLI</kbd> <kbd>Qwen Code</kbd><br>
  <kbd>siGit Code</kbd> <kbd>Stakpak</kbd> <kbd>VT Code</kbd>
</p>

---

## Leader 模型与服务商

在 **设置** 中配置（本地加密）。Leader 使用 `provider/model`。

| 服务商           | 接口类型             | 密钥                                              |
| ---------------- | -------------------- | ------------------------------------------------- |
| OpenAI           | OpenAI               | `OPENAI_API_KEY`                                  |
| Anthropic        | Anthropic Messages   | `ANTHROPIC_API_KEY`                               |
| Google（Gemini） | Google Generative AI | `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY` |
| xAI（Grok）      | OpenAI 兼容          | `XAI_API_KEY`                                     |
| DeepSeek         | OpenAI 兼容          | `DEEPSEEK_API_KEY`                                |

自定义网关：OpenAI / Anthropic / Google 兼容端点，或 Settings 中的 Custom（id + baseURL + key）。

---

## 社区与支持

- **问题与建议：** [Issues](https://github.com/xun404/pihuo-agent/issues)
- **支持项目：** [Star](https://github.com/xun404/pihuo-agent) 本仓库
- **贡献：** [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 本地运行与编译

需要 Node.js 22.19 或更高版本。

```bash
npm ci
npm run desktop
```

`npm run desktop` 会同时拉起桌面和本地 API。

```bash
npm run build
npm run build:runtime
```

打安装包：

```bash
npm run package:mac
npm run package:win
npm run package:linux
```

更多检查见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT License](./LICENSE)
