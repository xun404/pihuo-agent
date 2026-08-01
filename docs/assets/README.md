# README media assets

Referenced by root `README.md` and `docs/readme/README.zh-CN.md`.

| File | Purpose |
| ---- | ------- |
| `icon.png` | Brand mark |
| `readme-hero.png` | Hero under the tagline |
| `feature-wall/leader-chat.png` | Leader chat |
| `feature-wall/worker-cards.png` | Chat / worker process surface |
| `feature-wall/approvals.png` | Approvals / team inspector surface |
| `feature-wall/registry.png` | Agent Worker / registry surface |
| `feature-wall/settings-models.png` | Models & API keys |
| `feature-wall/sessions.png` | Projects & sessions sidebar |

## Refresh screenshots (CDP)

Demo project: `docs/demo/swarmdesk-showcase`  
Seed + capture:

```bash
# Terminal A — desktop with CDP
npm run desktop

# Terminal B — API must be healthy (:4111). If you killed the Electron-spawned API,
# either restart desktop or run the API with desktop auth disabled for capture:
#   MASTRA_PORT=4111 SWARMDESK_AGENT_DESKTOP_AUTH=0 node --import tsx packages/mastra-app/src/http-server.ts

node scripts/capture-readme-shots.mjs
```

This calls `POST /api/demo/seed` (showcase project + sample chat history) then writes PNGs under `docs/assets/`.

## Brand icon

Source of truth: `icon.png` only.

```bash
cp docs/assets/icon.png apps/desktop/public/icon.png build/icon.png
node apps/desktop/scripts/ensure-electron.mjs   # rebuild icns when needed
```
