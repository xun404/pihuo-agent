---
name: pihuo-preflight
description: Use before handing off a PiHuo code or documentation change to select and run proportionate local verification, then report what was and was not verified.
---

# PiHuo Preflight

Run the smallest set of checks that establishes the changed contract, then
report the commands and their outcomes. A green formatter is not evidence of
an ACP lifecycle or UI interaction.

## Establish a runnable checkout

Use Node.js 22.13+ and npm. A clean install is `npm ci`. If tests fail because
workspace packages such as `@pihuo-agent/core` cannot be resolved, first
verify whether `node_modules` is incomplete before treating the failure as a
product regression. Do not rewrite or delete a user's dependency directory to
make a check pass.

## Choose checks from the diff

- All authored changes: `git diff --check`; run the relevant focused tests.
- Desktop TypeScript or shared types: `npm run typecheck`, then the affected
  component/lib tests.
- UI behavior: run the affected component tests and use `pihuo-ui-verification`
  for an Electron smoke when the visible interaction changed.
- Runtime, HTTP, ACP, worker, approval, or session behavior: relevant runtime
  tests; include `npm test` when the affected suite is not isolated.
- Workflow/configuration changes: `npm run verify:workflows`.
- General source health for a substantial code change: `npm run lint`,
  `npm run check:source-size`, and `npm run format:check`.
- Build or package changes: `npm run build`, `npm run build:runtime`,
  `npm run verify:runtime`; for installer/package work also run
  `npm run package:dir` and `npm run smoke:packaged`.

`CONTRIBUTING.md` and CI define the full repository gate. Use that full set
for a release-ready claim or broad cross-package change; do not claim it was
run when only a focused check was practical.

## Hand-off

State the verification evidence, failures, skipped checks, and why each skip
is safe or still needs follow-up. Never hide an environment failure behind a
generic “not run” label.
