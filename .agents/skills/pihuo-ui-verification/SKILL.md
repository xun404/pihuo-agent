---
name: pihuo-ui-verification
description: Use when verifying a PiHuo Electron UI change end-to-end, especially chat, team, worker, approval, task-list, or active-session interactions.
---

# PiHuo UI Verification

Use the actual Electron renderer as the UI authority. Read and follow
`development-cdp` for startup, renderer/API/CDP readiness, authenticated
in-page API inspection, controlled React input, and stale-process handling.

## Verification sequence

1. Start the desktop app with `npm run desktop`, then independently verify the
   renderer, API (`4111` by default), and loopback CDP endpoint (`8315` by
   default).
2. Confirm the authoritative session state through the in-renderer API path
   before relying on DOM output.
3. Scope every DOM assertion to the visible
   `.chat-workspace-pane.active` that is not `aria-hidden`; multiple ChatPanels
   can remain mounted and otherwise produce false positives.
4. Exercise the changed gesture and its meaningful adjacent states: loading or
   empty, running, pending approval, completed, failed/timed-out, cancelled,
   and reload/recovery when applicable.
5. Capture a screenshot with `scripts/cdp-check.mjs shot` when visual hierarchy
   is part of acceptance. Keep tokens, local paths, private prompts, and other
   sensitive material out of screenshots and reports.

## Chat and worker invariants

- Verify a worker card is additive to—not a replacement for—the underlying
  Leader tool/process record.
- Verify TaskListCard content comes from the existing task-list signal and is
  not duplicated by a side panel or fabricated local state.
- Approval controls must target the active session and refresh from the
  authoritative result; do not use a hidden panel or a draft permission
  control as evidence.
- Use component/unit tests for deterministic rendering and CDP only for the
  real integration path. Report any live-model dependency separately rather
  than treating an unavailable provider as a UI pass.
