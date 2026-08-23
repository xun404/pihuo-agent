---
name: pihuo-i18n
description: Use when changing PiHuo desktop user-visible strings, locale keys, or maintained English/Chinese documentation pairs.
---

# PiHuo i18n

Keep each desktop message key semantically aligned across Simplified Chinese,
Traditional Chinese, and English. Do not embed new user-facing English or
Chinese literals in a component when the surface already uses the catalog.

## Desktop catalogs

1. Add or update the same key in
   `apps/desktop/src/i18n/catalogs/zh.ts` and `apps/desktop/src/i18n/catalogs/en.ts`.
2. Preserve the `MessageKey` contract and use the key through `useI18n` or the
   appropriate typed call site.
3. Regenerate, rather than hand-edit, the Traditional Chinese artifact:
   `npm run generate:zh-TW`. It writes
   `apps/desktop/src/i18n/zh-TW.catalog.ts` from Simplified Chinese with OpenCC.
4. Run the affected locale/component tests and inspect that all locale keys are
   present. Review contextual meaning, not only matching key counts.

Use stable terminology for Leader, Worker, task, approval, permission, and
session within the affected surface. Preserve interpolated variables and HTML
or formatting boundaries exactly.

## Documentation

PiHuo does not maintain automatic language pairs for every document. Only
update a matching README or explicitly paired document when it exists and the
change alters the shared claim. Do not create a broad translation sweep for a
localized implementation change.
