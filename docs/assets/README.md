# README media assets

Referenced by root `README.md` (English) and `docs/readme/README.zh-CN.md` (Chinese).

| Path                                       | Language | Purpose        |
| ------------------------------------------ | -------- | -------------- |
| `icon.png`                                 | —        | Brand mark     |
| `readme-hero.png` + `feature-wall/*`       | **en**   | Root README    |
| `zh/readme-hero.png` + `zh/feature-wall/*` | **zh**   | Chinese README |

## Refresh screenshots (CDP)

Demo project: `docs/demo/swarmdesk-showcase`

```bash
# Terminal A — desktop with CDP
npm run desktop

# Terminal B — API healthy on :4111 (Electron-spawned, or):
#   MASTRA_PORT=4111 SWARMDESK_AGENT_DESKTOP_AUTH=0 node --import tsx packages/mastra-app/src/http-server.ts

# English (default) → docs/assets/
npm run capture:readme -- --locale en

# Chinese → docs/assets/zh/
npm run capture:readme -- --locale zh
```

`POST /api/locale` + localStorage, then `POST /api/demo/seed` (showcase + sample history).

## Brand icon

Source of truth: `icon.png` only.

```bash
cp docs/assets/icon.png apps/desktop/public/icon.png build/icon.png
node apps/desktop/scripts/ensure-electron.mjs   # rebuild icns when needed
```
