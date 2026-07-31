# README media assets

Filenames are referenced by the root `README.md` and `docs/readme/README.zh-CN.md`.

| File | Purpose |
| ---- | ------- |
| `icon.png` | Final brand mark (1024²) — single asset for all surfaces |
| `readme-hero.png` | Hero under the tagline |
| `feature-wall/leader-chat.png` | Leader chat + streaming |
| `feature-wall/worker-cards.png` | Worker run cards |
| `feature-wall/approvals.png` | Permission approvals |
| `feature-wall/registry.png` | ACP Registry picker |
| `feature-wall/settings-models.png` | Models & API keys |
| `feature-wall/sessions.png` | Multi-session / project |

## Brand icon

**Source of truth: `icon.png` only** (no dark variant).

| Surface | Path |
| ------- | ---- |
| README | `docs/assets/icon.png` |
| Desktop UI / favicon | `apps/desktop/public/icon.png` |
| electron-builder | `build/icon.png` + `build/icon.icns` |
| Sidebar small glyph | same PNG via `BrandLogo` |

After replacing the mark:

```bash
cp docs/assets/icon.png apps/desktop/public/icon.png build/icon.png
# rebuild icns on macOS, then:
node apps/desktop/scripts/ensure-electron.mjs
```
