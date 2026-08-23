---
name: pihuo-doc-standards
description: Use when writing, moving, or reviewing PiHuo product documentation, handover notes, release notes, or implementation specifications.
---

# PiHuo Documentation Standards

Put durable information in the document a future maintainer or user will
actually consult. Documentation describes current or proposed behavior, its
limits, and the owner of the contract; it is not a chronological account of a
coding session.

## Choose the document home

- `README.md` / `README.zh-CN.md`: project entry points, setup, and
  user-facing capability boundaries.
- `CONTRIBUTING.md`: development commands and contributor workflow.
- `docs/releases/`: released behavior and migration notes.
- `docs/superpowers/specs/`: implementation-ready design decisions and
  accepted UI/architecture contracts.
- `HANDOVER.md`: active operational context that cannot yet be expressed in a
  permanent product or design document.

Read the owning code and tests before documenting inputs, defaults, failures,
durability, or security. When moving content, update inbound/outbound links in
the same change. Do not create a docs-site convention: PiHuo currently has no
documentation generator to synchronize.

## Required quality

- State the actor, action, timing, authority, and meaningful failure behavior.
- Mark limitations plainly: in-memory data, local-only APIs, permission
  boundaries, experimental status, and recovery behavior must not be implied
  away.
- Link to a single canonical explanation instead of duplicating a protocol or
  design rationale across files.
- Update translations only where the repository maintains a real paired
  document; use `pihuo-i18n` for desktop catalogs.
