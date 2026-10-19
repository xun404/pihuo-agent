<h1 align="center">
  <a href="https://github.com/xun404/pihuo-agent">PiHuo</a>
</h1>

<p align="center">
  <a href="https://github.com/xun404/pihuo-agent/stargazers"><img src="https://img.shields.io/github/stars/xun404/pihuo-agent?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/xun404/pihuo-agent/blob/main/LICENSE"><img src="https://img.shields.io/github/license/xun404/pihuo-agent" alt="License" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
</p>

<p align="center">
  <sub><a href="../../README.md">中文</a></sub>
</p>

<p align="center">
  <strong>PiHuo: you name the job, Pi breaks it up and hands it out, local workers finish it.</strong>
</p>

<p align="center">
  <img src="../assets/readme-hero.png" alt="PiHuo desktop" width="960" />
</p>

## Supported Agents

Built-in presets plus **ACP Registry** agents. Registry availability depends on platform, install method (`npx` / `uvx` / binary), and each agent’s own login. Agent CLIs are **not** bundled — install them separately.

### Built-in presets

<p>
  <kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="" width="16" valign="middle" /> Claude Code</kbd> &nbsp;
  <kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="" width="16" valign="middle" /> Codex CLI</kbd> &nbsp;
  <kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="" width="16" valign="middle" /> OpenCode</kbd>
</p>

| Agent           | Primary role | Also                    |
| --------------- | ------------ | ----------------------- |
| **Claude Code** | coder        | plan, research, general |
| **Codex CLI**   | review       | coder, test, general    |
| **OpenCode**    | general      | coder, plan, test       |

### ACP Registry (bundled catalog)

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

## Leader models &amp; providers

Configure in **Settings** (encrypted on disk). Leader uses `provider/model` ids.

### Built-in providers

| Provider        | API style            | Key                                               |
| --------------- | -------------------- | ------------------------------------------------- |
| OpenAI          | OpenAI               | `OPENAI_API_KEY`                                  |
| Anthropic       | Anthropic Messages   | `ANTHROPIC_API_KEY`                               |
| Google (Gemini) | Google Generative AI | `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY` |
| xAI (Grok)      | OpenAI-compatible    | `XAI_API_KEY`                                     |
| DeepSeek        | OpenAI-compatible    | `DEEPSEEK_API_KEY`                                |

### Custom / gateway APIs

| Style                    | Typical use                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| **OpenAI-compatible**    | OpenRouter, Ollama, SiliconFlow, Azure-compatible gateways, local proxies |
| **Anthropic-compatible** | Anthropic-protocol proxies                                                |
| **Google-compatible**    | Gemini-style endpoints                                                    |
| **Custom**               | Other gateways (id + base URL + key env in Settings)                      |

---

## Community &amp; Support

- **Issues &amp; ideas:** [Open an issue](https://github.com/xun404/pihuo-agent/issues)
- **Show support:** [Star](https://github.com/xun404/pihuo-agent) the repo
- **Maintainers:** [CONTRIBUTING.md](../../CONTRIBUTING.md)

---

## Run and build locally

Node.js 22.19 or newer.

```bash
npm ci
npm run desktop
```

`npm run desktop` starts the desktop app and the local API.

```bash
npm run build
npm run build:runtime
```

Installers:

```bash
npm run package:mac
npm run package:win
npm run package:linux
```

More checks are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## License

PiHuo is free and open source under the [MIT License](../../LICENSE).
