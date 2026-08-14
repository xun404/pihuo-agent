# Custom themes

PiHuo loads user color themes from OpenChamber-compatible JSON files. A
custom theme is added to the built-in theme list after it passes the same
normalizer used by the bundled themes. The built-in source files are kept in
[`apps/desktop/src/theme/themes`](../apps/desktop/src/theme/themes) for
reference.

## Theme directory

The desktop app reads regular files from a `themes` directory under its
configuration root:

| Platform or setting          | Directory                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| macOS / Linux (default)      | `$XDG_CONFIG_HOME/pihuo-agent/themes`, or `$HOME/.config/pihuo-agent/themes` when `XDG_CONFIG_HOME` is unset |
| Windows (default)            | `%APPDATA%\pihuo-agent\themes`                                                                                   |
| `PIHUO_AGENT_DATA_DIR`   | `$PIHUO_AGENT_DATA_DIR/themes`                                                                                   |
| `PIHUO_AGENT_AGENTS_DIR` | `$PIHUO_AGENT_AGENTS_DIR/themes` (alias for `PIHUO_AGENT_DATA_DIR`)                                          |

The data-directory environment variables override the platform default. The
app does not choose a different theme directory from the Settings UI; use an
environment override when the default path is not suitable.

## File names and loading rules

- Put one theme object in each top-level regular file whose name ends in
  `.json` (the extension check is case-insensitive). A name such as
  `nebula-light.json` is recommended, but the file name does not have to match
  `metadata.id`.
- Non-JSON files, directories, and symbolic links are skipped.
- The loader considers the first 100 JSON candidates in filename order. A file
  larger than 256 KiB is skipped.
- A malformed or invalid file is never loaded. JSON parsing and theme
  validation happen independently for each file, so one broken file cannot
  hide valid files next to it.

## JSON schema

### Metadata

`metadata` is required:

| Field         | Required | Rules                                                                                                              |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`          | Yes      | 1–64 characters; after trimming and lowercasing it must match `[a-z0-9][a-z0-9._-]*`. Use a unique ID per variant. |
| `name`        | Yes      | Any non-empty display name.                                                                                        |
| `variant`     | Yes      | Exactly `"light"` or `"dark"`.                                                                                     |
| `description` | No       | Optional descriptive text retained by the theme metadata.                                                          |
| `version`     | No       | Optional version text retained by the theme metadata.                                                              |
| `tags`        | No       | Accepted as OpenChamber metadata, but not used by the desktop theme picker.                                        |

### Colors

`colors` and all five groups below are required. Every required value is a
non-empty string; the desktop adapter does not restrict the color notation, so
hex, `rgb()`, `hsl()`, and other CSS color strings can be used.

Required fields:

- `colors.primary.base`
- `colors.surface.background`, `foreground`, `muted`, `mutedForeground`,
  `elevated`, `subtle`
- `colors.interactive.border`, `hover`, `active`
- `colors.status.error`, `errorBackground`, `warning`, `warningBackground`,
  `success`, `successBackground`, `info`, `infoBackground`
- `colors.syntax.base.background`, `foreground`, `comment`, `keyword`,
  `string`, `number`, `function`, `type`, `operator`

The following OpenChamber fields are optional and may be included: additional
primary, surface, interactive, and status colors; `syntax.base.variable`;
`syntax.tokens`; `syntax.highlights`; and the `pr`, `markdown`, `chat`, and
`tools` groups. The desktop adapter maps only the values it needs to its
desktop color tokens. In particular, `markdown`, `chat`, and `tools` values do
not currently create separate desktop tokens.

### Appearance and fonts

There is no top-level `appearance` object in the custom-theme format. Shared
typography sizes and weights, spacing, radii, controls, layout, and motion are
application-level values from `appearance.config.ts`, not per-file overrides.

Theme-owned fonts are the supported appearance override. Add an optional
`config.fonts` object:

```json
{
  "config": {
    "fonts": {
      "sans": "Inter, system-ui, sans-serif",
      "mono": "JetBrains Mono, ui-monospace, monospace",
      "heading": "Inter, system-ui, sans-serif"
    }
  }
}
```

`sans` and `mono` must both be non-empty for the override to apply. They become
the active `--font` and `--mono` CSS variables, so the selected theme applies
these fonts throughout the desktop UI. PiHuo does not download or install
font files; include fallbacks in each family list. `heading` is accepted in
`config.fonts` but is not currently mapped to a separate desktop CSS variable.

`config.transitions` is accepted by the OpenChamber source shape but is not
currently applied by the desktop renderer. Likewise, `tags` and source fields
that are not mapped above do not change the desktop appearance.

## Minimal valid theme

Save this as `nebula-light.json` in the theme directory. It contains every
field the normalizer requires and an applied font override, while omitting all
optional color groups:

```json
{
  "metadata": {
    "id": "nebula-light",
    "name": "Nebula Light",
    "variant": "light"
  },
  "colors": {
    "primary": {
      "base": "#2563eb"
    },
    "surface": {
      "background": "#ffffff",
      "foreground": "#172033",
      "muted": "#f1f5f9",
      "mutedForeground": "#64748b",
      "elevated": "#f8fafc",
      "subtle": "#e2e8f0"
    },
    "interactive": {
      "border": "#cbd5e1",
      "hover": "#dbeafe",
      "active": "#bfdbfe"
    },
    "status": {
      "error": "#dc2626",
      "errorBackground": "#fee2e2",
      "warning": "#d97706",
      "warningBackground": "#fef3c7",
      "success": "#16a34a",
      "successBackground": "#dcfce7",
      "info": "#0284c7",
      "infoBackground": "#e0f2fe"
    },
    "syntax": {
      "base": {
        "background": "#f8fafc",
        "foreground": "#172033",
        "comment": "#64748b",
        "keyword": "#7c3aed",
        "string": "#047857",
        "number": "#c2410c",
        "function": "#2563eb",
        "type": "#0f766e",
        "operator": "#475569"
      }
    }
  },
  "config": {
    "fonts": {
      "sans": "Inter, system-ui, sans-serif",
      "mono": "JetBrains Mono, ui-monospace, monospace"
    }
  }
}
```

## Load and select a theme

1. Create the directory above if it does not exist.
2. Save one or more `.json` files there.
3. Open PiHuo and go to **Settings → General**.
4. Click **Reload themes**. The directory path is shown beside the reload
   description after the desktop bridge responds.
5. Choose the new theme in the **Light theme** or **Dark theme** selector.

The app also performs a theme-directory read when the renderer starts. A
successful reload replaces the current custom registry with the valid files it
found. If a reload contains files but none normalize successfully, the last
known-good custom registry is kept; a directory with no custom files can
legitimately report zero loaded themes.

## Built-in overrides and variants

Custom themes are merged before built-ins. A custom theme with the same
`metadata.variant` and normalized `metadata.id` replaces that built-in entry in
the picker. The same ID in the opposite variant is a separate theme and does
not override it. If multiple custom files normalize to the same variant and
ID, the first custom file in the loader's filename order wins.

Removing a selected custom theme and then completing a successful reload makes
that ID unavailable; PiHuo falls back to the built-in default for the
corresponding variant (`mono-plus-light` or `mono-plus-dark`).

## Troubleshooting

- **The theme does not appear:** confirm the file is directly inside the
  `themes` directory, has a `.json` extension, and uses a valid `id`, `name`,
  and `variant`. Check every required color path; missing groups or empty
  strings make the file invalid.
- **The reload count is zero:** the directory may be missing, all JSON files
  may be malformed, or all parsed objects may fail schema validation. Invalid
  files are skipped and a zero count is valid when no custom theme normalized.
- **Only some files load:** check the 100-file and 256 KiB limits, and make
  sure the file is not a directory or symbolic link.
- **The font did not change:** provide both non-empty `config.fonts.sans` and
  `config.fonts.mono`, include fallbacks, and verify that the selected theme's
  variant matches the active Light/Dark mode.
- **The built-in still appears:** use the exact same normalized `id` and
  `variant` as the built-in. A different variant or a typo creates a separate
  entry instead of an override.
