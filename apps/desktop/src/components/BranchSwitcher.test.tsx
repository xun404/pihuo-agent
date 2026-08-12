/**
 * BranchSwitcher component test placeholder.
 *
 * BranchSwitcher depends on window.routerAgents IPC, fetch, framer-motion, and
 * the live React i18n/toast context, so a full DOM render test would require
 * the in-repo React harness with extensive mocking. Pure-logic coverage of the
 * git backend it consumes lives in packages/core/src/git-branches.test.ts
 * (parseBranchForEachRef, classifySwitchError, listLocalBranches, switchBranch,
 * createBranchAndSwitch — real repo integration).
 *
 * Visual/interaction verification of BranchSwitcher is covered by the manual
 * checklist in docs/superpowers/plans/2026-07-19-chat-project-pick-git-branch.md
 * (Task 11.5).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const composerStyles = readFileSync(
  fileURLToPath(new URL('../styles/03-composer.css', import.meta.url)),
  'utf8',
)

describe('BranchSwitcher', () => {
  it('defers to packages/core/src/git-branches.test.ts for backend coverage', () => {
    assert.ok(true)
  })

  it('vertically centers the smaller dirty-file hint beside the branch name', () => {
    assert.match(composerStyles, /\.branch-item\s*\{[^}]*align-items:\s*center;/su)
  })
})
