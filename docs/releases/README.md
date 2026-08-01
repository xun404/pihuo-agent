# Release notes contract

GitHub Releases for SwarmDesk use a **checked-in, bilingual notes file** per tag. Do not rely on GitHub auto-generated notes alone.

## File layout

| Path | Purpose |
| ---- | ------- |
| `docs/releases/README.md` | This structure contract |
| `docs/releases/vX.Y.Z.md` | Notes for tag `vX.Y.Z` (must match root `package.json` version) |

Before cutting a tag:

1. Bump root and `apps/desktop` package versions to `X.Y.Z`.
2. Author `docs/releases/vX.Y.Z.md` following the template below.
3. Commit the notes on the same commit (or an earlier commit on `main`) that the tag will point to.
4. Push `vX.Y.Z`. The release workflow validates the file and publishes it as the Release body.

## Required structure

The body is **English first, then Chinese**. Heading levels and section titles must match exactly (CI verifies this).

```markdown
# SwarmDesk vX.Y.Z

## English

### Summary

One short paragraph: what this product is / what this tag delivers.

### Highlights

- Stable product capabilities users should expect from this build
  (keep durable; avoid one-off bugfix noise)

### Changes in this release

- User-facing changes specific to this tag
- Prefer verbs: add / fix / improve / document
- Omit pure CI-only or formatting commits unless they affect downloads

### Downloads

| Platform | Artifact |
| -------- | -------- |
| …        | `SwarmDesk-Agent-X.Y.Z-…` |

### Notes

- Signing, platform gaps, known limitations for this tag

## 中文

### 摘要

一句话产品定位 / 本 tag 交付内容。

### 产品能力

- 与 English **Highlights** 对应的能力列表

### 本次变更

- 与 English **Changes in this release** 对应

### 下载

| 平台 | 产物 |
| ---- | ---- |
| …    | `SwarmDesk-Agent-X.Y.Z-…` |

### 说明

- 与 English **Notes** 对应
```

Optional footer (not validated):

```markdown
**Commits:** https://github.com/xun404/swarmdesk-agent/commits/vX.Y.Z
```

## Rules

1. **Tag ↔ file:** tag `vX.Y.Z` requires `docs/releases/vX.Y.Z.md`. Missing file fails the release job.
2. **Bilingual:** both `## English` and `## 中文` sections are required; content should convey the same facts.
3. **User-facing first:** Highlights + Changes describe product/UX; CI-only work stays out unless it changes what users download.
4. **Artifacts match matrix:** Downloads tables list only platforms actually published for this tag (today: macOS arm64 + Linux x64; Windows optional until re-enabled).
5. **No secrets:** notes are public; never include keys, tokens, or internal URLs.
6. **Title:** GitHub Release title is `SwarmDesk vX.Y.Z` (set by workflow).

## Workflow integration

`.github/workflows/release.yml` (Publish job):

1. `node scripts/verify-release-notes.mjs docs/releases/${RELEASE_TAG}.md ${RELEASE_TAG}`
2. Create or update the GitHub Release with `--notes-file` that path (not `--generate-notes`)
3. Upload installers + `SHA256SUMS.txt` as today

See also: `docs/superpowers/specs/2026-07-16-github-actions-desktop-packaging-design.md` §6.2.
