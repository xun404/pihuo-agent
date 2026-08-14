<h1 align="center">
  <a href="https://github.com/xun404/pihuo-agent">
    <img src="docs/assets/icon.png" alt="PiHuo" width="64" valign="middle" />
  </a>
  PiHuo
</h1>

<p align="center">
  <a href="https://github.com/xun404/pihuo-agent/stargazers"><img src="https://img.shields.io/github/stars/xun404/pihuo-agent?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/xun404/pihuo-agent/releases"><img src="https://img.shields.io/github/v/release/xun404/pihuo-agent?label=release" alt="Latest release" /></a>
  <a href="https://github.com/xun404/pihuo-agent/blob/main/LICENSE"><img src="https://img.shields.io/github/license/xun404/pihuo-agent" alt="License" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
</p>

<p align="center">
  <sub><a href="docs/readme/README.zh-CN.md">中文</a></sub>
</p>

<p align="center">
  <strong>PiHuo: you name the job, Pi breaks it up and hands it out, local workers finish it.</strong>
</p>

<h3 align="center"><a href="https://github.com/xun404/pihuo-agent/releases/latest"><ins>Download PiHuo</ins></a></h3>

<p align="center">
  <img src="docs/assets/readme-hero.png" alt="PiHuo desktop — Leader chat, workers, and project context" width="960" />
</p>

## Features

<table>
<tr>
<td width="50%" valign="middle">

### Leader chat &amp; delegation

Talk to a Supervisor Leader that plans work and dispatches **role-aware** jobs (`plan` · `coder` · `review` · `test` · `research` · `general`) to the right ACP worker.

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/leader-chat.png" alt="Leader chat and delegation" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Live worker cards

Watch each job stream in place — tool calls, terminal output, and final status on a single card per job (no duplicate clutter).

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/worker-cards.png" alt="Worker run cards" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Approvals you control

ACP permission requests surface in chat and the side panel. The called Agent remains responsible for its own direct operations, such as reads or project-local edits it already considers safe. Each Session has a two-state shield: **Default** leaves permission requests emitted by the Agent for manual approval; **Auto-accept** sends those requests through the same durable approval path and immediately selects an allow option. Changes apply immediately to running and pending work.

Auto-accept applies only to the current Session and prefers the Agent's `allow_once` option. Enabling the warning-colored shield immediately accepts every currently pending permission in that Session and affects future ACP requests in real time; the mutation response also reports which items were resolved and which failed, and the shield/approval panel shows the current Session's remaining pending and failed counts, so a partial failure cannot look like a clean success. Disabling it affects the next request immediately. Permissions have no approval timeout and remain pending until the user responds, enables auto-accept, cancels them, or terminates the Job; the active Job timer pauses while approval is pending, while pending Jobs still consume ACP capacity. If an Agent offers `allow_always`, that Agent—not PiHuo—controls its scope and lifetime, and turning the shield off cannot generically revoke an Agent-side grant. If the runtime restarts, the pending approval is cancelled and the task is marked `RUNTIME_RESTARTED`; run the task again manually.

This policy is an application-level ACP approval boundary, not an OS sandbox. It does not intercept direct system calls made by an Agent process.

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/approvals.png" alt="Permission approvals" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### ACP Registry agents

Discover and prepare agents from the official ACP Registry (bundled offline snapshot). Explicit **prepare → trust → authenticate** before dispatch.

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/registry.png" alt="ACP Registry agent picker" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Models &amp; keys in Settings

Configure Leader models and API keys with encrypted local storage. Built-in providers plus OpenAI / Anthropic / Google-compatible custom gateways.

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/settings-models.png" alt="Settings — models and API keys" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Projects &amp; sessions

Open a local project path, keep multiple chat sessions, rename from the header, and resume ACP context across restarts when the agent supports it.

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/sessions.png" alt="Projects and sessions" width="100%" />
</td>
</tr>
</table>

**Also in the box:**

- **i18n** — Chinese / English in the title bar
- **Git &amp; files** — real `git status` and bounded project tree in the UI
- **Step budget** — configurable Leader max steps with continue-on-same-thread
- **Local-first** — data under `~/.config/pihuo-agent/` (no cloud account required)
- **Custom themes** — load OpenChamber-compatible JSON themes with the [custom theme guide](./docs/custom-themes.md)
- **ACP reasoning intensity** — per-agent raw reasoning values discovered from `configOptions` (e.g. `reasoning_effort` for Codex, `effort` for Claude). Three-level inheritance: TeamMember override → Worker default → ACP Agent default. When a Worker or model does not declare a reasoning selector, unconfigured roles continue normally; explicit reasoning values always fail closed instead of silently falling back.

---

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

## Install

### Desktop — macOS, Windows, Linux

- **[Download the latest release](https://github.com/xun404/pihuo-agent/releases/latest)**
- Builds (names match `PiHuo-${version}-…`):

  | Platform | Arch                  | Package       |
  | -------- | --------------------- | ------------- |
  | macOS    | Apple Silicon (arm64) | DMG, ZIP      |
  | Windows  | x64                   | NSIS EXE      |
  | Linux    | x64                   | AppImage, DEB |

- Prefer verifying `SHA256SUMS` in the same release.

```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS

# Windows PowerShell
Get-FileHash .\PiHuo-0.1.0-win-x64.exe -Algorithm SHA256
```

> Installers are currently **unsigned** (no macOS notarization / Windows code signing). Gatekeeper or SmartScreen may warn — download only from this repo’s Releases.

**After install:** open the app → **Settings** (Leader API keys) → open a project → register workers → chat.

---

## Community &amp; Support

- **Issues &amp; ideas:** [Open an issue](https://github.com/xun404/pihuo-agent/issues)
- **Show support:** [Star](https://github.com/xun404/pihuo-agent) the repo
- **Maintainers:** [CONTRIBUTING.md](./CONTRIBUTING.md) · [docs/HANDOVER.md](./docs/HANDOVER.md)

Local data lives under `~/.config/pihuo-agent/` (settings, encrypted secrets, sessions, registry LKG).

---

## Developing

Want to contribute or run from source? See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

PiHuo is free and open source under the [MIT License](./LICENSE).
