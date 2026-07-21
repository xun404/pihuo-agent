# README media assets

Filenames are referenced by the root `README.md` and `docs/readme/README.zh-CN.md`.

| File | Purpose |
| ---- | ------- |
| `icon.svg` | Brand mark source — **light** (`theme-white`); desktop UI / favicon |
| `icon_dark.svg` | Brand mark source — **dark** (`theme-dark`); desktop UI / favicon |
| `icon.png` | Rasterized light (1024²) — README header, packaging, favicon fallback |
| `icon_dark.png` | Rasterized dark (1024²) — README dark `<picture>` source |
| `readme-hero.png` | Hero under the tagline |
| `feature-wall/leader-chat.png` | Leader chat + streaming |
| `feature-wall/worker-cards.png` | Worker run cards |
| `feature-wall/approvals.png` | Permission approvals |
| `feature-wall/registry.png` | ACP Registry picker |
| `feature-wall/settings-models.png` | Models & API keys |
| `feature-wall/sessions.png` | Multi-session / project |

## Brand icon pipeline

Source of truth: `icon.svg` / `icon_dark.svg` (honeycomb mark; root class `theme-white` vs `theme-dark`).

Applied to:

| Surface | Path |
| ------- | ---- |
| README (EN/ZH) | `icon.png` + `icon_dark.png` via `<picture>` (PNG for GitHub reliability) |
| Desktop favicon / home logo | `apps/desktop/public/icon.svg` + `icon_dark.svg` |
| electron-builder (mac/win/linux) | `build/icon.png` (light raster) |
| BrowserWindow icon | `public/icon.png` → Vite `dist/icon.png` |
| Sidebar / Leader small glyph | `🐝` emoji via `IconQueenBee` / `IconSupervisor` |

To regenerate rasters after editing the SVGs (requires Google Chrome):

```bash
# from repo root — embed SVG and screenshot at 1024²
python3 - <<'PY'
from pathlib import Path
for name, out in [("icon.svg", "icon.png"), ("icon_dark.svg", "icon_dark.png")]:
    svg = Path(f"docs/assets/{name}").read_text()
    svg = svg.replace('width="100%"', 'width="1024"').replace('height="100%"', 'height="1024"')
    Path(f"/tmp/swarmdesk-{name}.html").write_text(
        f'<!doctype html><html><head><meta charset="utf-8"/>'
        f'<style>html,body{{margin:0;width:1024px;height:1024px;background:transparent;overflow:hidden}}</style>'
        f'</head><body>{svg}</body></html>'
    )
print("html ready")
PY
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot=docs/assets/icon.png "file:///tmp/swarmdesk-icon.svg.html"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot=docs/assets/icon_dark.png "file:///tmp/swarmdesk-icon_dark.svg.html"
cp docs/assets/icon.png build/icon.png
cp docs/assets/icon.svg docs/assets/icon_dark.svg docs/assets/icon.png apps/desktop/public/
```

Replace feature screenshots with real captures (same paths/names). GIFs optional.
