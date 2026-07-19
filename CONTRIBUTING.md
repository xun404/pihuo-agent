# Contributing to Router Agents

Thanks for helping improve Router Agents.

## Development setup

Requirements:

- Node.js 22.13 or newer (CI pins 22.13.0)
- npm only — do not introduce pnpm/yarn lockfiles
- Git
- The ACP Agent CLIs needed for any integration you want to exercise

Install the exact dependency graph:

```bash
npm ci
```

Keep `package-lock.json` in sync with dependency changes. Do not commit API
keys, credentials, `.env` files, generated runtime bundles, release
artifacts, or alternate package-manager lockfiles (`pnpm-lock.yaml`,
`yarn.lock`).

Local build leftovers can be removed with:

```bash
npm run clean
```

## Before opening a pull request

Run the checks that apply to your change:

```bash
npm test
npm run verify:workflows
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run build:runtime
npm run verify:runtime
```

For desktop packaging changes, also build the unpacked app and run its
packaged smoke test:

```bash
npm run package:dir
npm run smoke:packaged
```

Native installer targets are:

| Platform | Architecture | Formats       |
| -------- | ------------ | ------------- |
| macOS    | arm64        | DMG, ZIP      |
| Windows  | x64          | NSIS EXE      |
| Linux    | x64          | AppImage, DEB |

Use the corresponding native runner when validating platform-specific
packaging. The current installers are unsigned, so signing and notarization
are not prerequisites for contributions.

## Pull requests

Keep changes focused, explain behavior and compatibility impact, and add
regression tests for fixes or new behavior. Update README or handover
documentation when user-facing commands, packaging, security boundaries, or
known limitations change.

By contributing, you agree that your contribution is licensed under the MIT
License.
