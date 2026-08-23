---
name: pihuo-change-design
description: Use when planning a non-trivial PiHuo behavior, lifecycle, protocol, or user-visible UI change that needs an implementation-ready design before code is changed.
---

# PiHuo Change Design

Write the design before implementation when a change crosses a UI/API/runtime
boundary, changes ACP or approval behavior, affects persisted sessions, or
materially changes the user experience. Do not require a design document for a
small localized fix whose behavior and tests are already obvious.

## Location and structure

Create one document at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
Start with status, owner, scope, and a concise decision. Then cover:

1. Current behavior, with the actual source of truth and the user problem.
2. Desired behavior and explicit non-goals.
3. Data flow and ownership: renderer, desktop/API boundary, Pi runtime, ACP
   worker, persisted data, and recovery paths that are involved.
4. UI states and interactions, including loading, empty, pending approval,
   failure, cancellation, restart, and accessibility where applicable.
5. The file-level implementation plan, preserving existing contracts whenever
   a presentation-only change is sufficient.
6. Compatibility, migration, rollback, observability, and security impact.
7. Tests and user-observable acceptance criteria.

For discussion or worker UI, distinguish durable Leader messages from live
worker state and from local presentation state. Do not invent agent-to-agent
messages or claim persistence when the source is an in-memory view.

## PiHuo-specific checks

- Treat the loopback desktop API, session snapshot, and `LeaderChatStore` as
  separate boundaries; name the authority for every displayed field.
- Preserve worker ordering and recovery semantics from
  `worker-card-placement.ts`, `worker-run-reducer.ts`, and the ACP session
  manager. A mock layout is not a reason to alter event semantics.
- Keep approval decisions and permission changes explicit; identify which
  surface makes the mutation and how the UI refreshes from authoritative
  state.
- Reuse the existing TaskListCard contract before proposing a new task model.
  Its `data-signal` snapshots are not evidence of a general task database.
- For visible desktop strings, include the i18n key and catalog impact. Read
  `pihuo-i18n` when the implementation begins.

Design documents state the shipped or proposed contract, not an implementation
diary. Remove abandoned alternatives once a decision is made, while retaining
the reasoning needed to understand a material trade-off.
