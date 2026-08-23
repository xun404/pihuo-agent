---
name: pihuo-prose
description: Use when creating or reviewing PiHuo comments, JSDoc, prompts, tool descriptions, diagnostics, documentation, or user-visible strings.
---

# PiHuo Prose Standard

Write for the reader who must act on the text. Preserve the complete factual
claim: who does what, when it happens, what is authoritative, and what failure
or limitation matters. Prefer specific nouns and observable behavior over
implementation narration.

## Apply to every changed passage

Review Markdown, JSDoc, comments, prompts, tool schemas/descriptions, logs,
errors, empty states, and labels. Verify the text against its owning code or
test rather than polishing wording in isolation.

- Explain non-obvious invariants, ordering, security boundaries, and recovery
  conditions; omit comments that merely restate syntax.
- Do not leave review discussion, migration scratch notes, or “we changed
  this because…” history in production comments or user documentation.
- Do not claim success before the authoritative session/worker state confirms
  it. Name cancellation, pending approval, partial result, or restart where it
  changes the user’s next action.
- Keep model-facing prompts and tool descriptions task-scoped; avoid exposing
  unrelated internal concepts or unsupported capabilities.
- Keep user-visible wording concise and actionable. When it changes, review
  English, Simplified Chinese, and generated Traditional Chinese coverage with
  `pihuo-i18n`.

Documentation may retain a short decision rationale where it prevents a
costly architectural misunderstanding. Put that rationale in its canonical
specification instead of repeating it at each call site.
