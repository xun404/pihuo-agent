<h1 align="center">
  <a href="https://github.com/xun404/pihuo-agent">
    <img src="../assets/icon.png" alt="PiHuo" width="64" valign="middle" />
  </a>
  PiHuo
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
  <kbd>Agoragentic</kbd> &nbsp; <kbd>Amp</kbd> &nbsp; <kbd>Auggie CLI</kbd> &nbsp; <kbd>Autohand Code</kbd> &nbsp;
  <kbd>Claude Agent</kbd> &nbsp; <kbd>Cline</kbd> &nbsp; <kbd>Codebuddy Code</kbd> &nbsp; <kbd>Codex</kbd> &nbsp;
  <kbd>Cortex Code</kbd> &nbsp; <kbd>Corust Agent</kbd> &nbsp; <kbd>crow-cli</kbd> &nbsp; <kbd>Cursor</kbd> &nbsp;
  <kbd>DeepAgents</kbd> &nbsp; <kbd>Devin</kbd> &nbsp; <kbd>DimCode</kbd> &nbsp; <kbd>Dirac</kbd> &nbsp;
  <kbd>Factory Droid</kbd> &nbsp; <kbd>fast-agent</kbd> &nbsp; <kbd>Gemini CLI</kbd> &nbsp; <kbd>GitHub Copilot</kbd> &nbsp;
  <kbd>GLM Agent</kbd> &nbsp; <kbd>goose</kbd> &nbsp; <kbd>Grok Build</kbd> &nbsp; <kbd>Harn</kbd> &nbsp;
  <kbd>Junie</kbd> &nbsp; <kbd>Kilo</kbd> &nbsp; <kbd>Kimi CLI</kbd> &nbsp; <kbd>Minion Code</kbd> &nbsp;
  <kbd>Mistral Vibe</kbd> &nbsp; <kbd>Nova</kbd> &nbsp; <kbd>OpenCode</kbd> &nbsp; <kbd>pi ACP</kbd> &nbsp;
  <kbd>Poolside</kbd> &nbsp; <kbd>Qoder CLI</kbd> &nbsp; <kbd>Qwen Code</kbd> &nbsp; <kbd>siGit Code</kbd> &nbsp;
  <kbd>Stakpak</kbd> &nbsp; <kbd>VT Code</kbd>
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

## Developing

Want to contribute or run from source? See [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## License

PiHuo is free and open source under the [MIT License](../../LICENSE).
