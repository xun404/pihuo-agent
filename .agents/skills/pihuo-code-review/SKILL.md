---
name: pihuo-code-review
description: Use when reviewing a PiHuo change or pull request for correctness, lifecycle safety, user-visible behavior, and appropriate verification evidence.
---

# Reviewing a PiHuo Change

Review the exact diff and enough surrounding code to trace each changed
contract. Prioritize a substantiated correctness, safety, or behavior finding
over stylistic comments. Keep the review scoped to the requested revision and
do not edit code unless the user asks for a fix.

## Establish the change boundary

1. Inspect `git status`, the verified base/head, and the diff before judging
   behavior. Do not attribute unrelated dirty files to the change under
   review.
2. Read `CONTRIBUTING.md`, relevant tests, and any linked specification in
   `docs/superpowers/specs/`.
3. Trace both sides of every altered interface: renderer, desktop HTTP route,
   shared type, Pi runtime, and ACP worker as applicable.

## PiHuo review focus

- **Session and recovery:** preserve the durable session/snapshot authority;
  check reload, reconnect, terminal worker state, and restart behavior.
- **ACP lifecycle:** test cancellation during awaits, teardown, late events,
  duplicate delivery, approval resolution, and error propagation. Worker cards
  must not conceal a dispatch tool or change ordered event history.
- **Security boundary:** desktop API and CDP remain loopback-only; never log
  desktop tokens, credentials, or raw private prompts unnecessarily. Follow a
  permission/denial path through to the actual operation.
- **UI correctness:** distinguish a visible active ChatPanel from mounted but
  hidden panels. Check loading, empty, approval, error, timeout, and cancelled
  states—not only the happy path.
- **Data ownership:** do not turn view-local data, such as Leader task-list
  snapshots, into a persistence promise. Check every cache and UI echo against
  its authoritative source.
- **Prose and i18n:** review changed comments, prompts, diagnostics, docs, and
  visible strings for accuracy; localized UI text needs matching catalogs.

## Evidence and report

Confirm the narrowest relevant checks from `pihuo-preflight` were run and
identify gaps that automation cannot establish. Report each finding with its
location, impact, and concrete evidence. Separate blockers from suggestions;
do not report an issue merely because a different style is possible.
