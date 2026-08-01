import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  parseBranchForEachRef,
  classifySwitchError,
  listLocalBranches,
  switchBranch,
  createBranchAndSwitch,
  type BranchSwitchIssueCode,
} from './git-branches.js'

describe('parseBranchForEachRef', () => {
  it('parses name / upstream / hash / timestamp, tolerates empty upstream', () => {
    // Format: name \0 upstream \0 objectname \0 committerdate:unix (seconds)
    // parser multiplies seconds by 1000 → ms
    const raw = [
      'main\u0000origin/main\u0000abc123\u00001700000000',
      'feature/x\u0000\u0000def456\u00001701111111',
    ].join('\n')
    const branches = parseBranchForEachRef(raw, 'main')
    assert.equal(branches.length, 2)
    assert.equal(branches[0]!.name, 'main')
    assert.equal(branches[0]!.isCurrent, true)
    assert.equal(branches[0]!.upstreamName, 'origin/main')
    assert.equal(branches[0]!.commitHash, 'abc123')
    assert.equal(branches[0]!.commitTimestampMs, 1700000000000)
    assert.equal(branches[1]!.name, 'feature/x')
    assert.equal(branches[1]!.isCurrent, false)
    assert.equal(branches[1]!.upstreamName, undefined)
  })

  it('sorts current first, then by commitTimestampMs desc, then alphabetical', () => {
    // committerdate:unix is seconds; parser multiplies by 1000 → ms
    const raw = [
      'aaa\u0000\u0000h1\u00001700000000',
      'current\u0000\u0000h2\u00001690000000',
      'bbb\u0000\u0000h3\u00001701111111',
    ].join('\n')
    const branches = parseBranchForEachRef(raw, 'current')
    assert.equal(branches[0]!.name, 'current')
    assert.equal(branches[1]!.name, 'bbb') // newer timestamp
    assert.equal(branches[2]!.name, 'aaa')
  })

  it('ignores blank lines, keeps name-only malformed records', () => {
    const raw = '\n\n  \nonly-name'
    const branches = parseBranchForEachRef(raw, null)
    assert.equal(branches.length, 1)
    assert.equal(branches[0]!.name, 'only-name')
  })
})

describe('classifySwitchError', () => {
  const cases: Array<[string, BranchSwitchIssueCode]> = [
    [
      'error: Your local changes to the following files would be overwritten by checkout:\n\ta.ts\nPlease commit your changes or stash them before you switch branches.',
      'tracked-changes-would-be-overwritten',
    ],
    [
      'error: The following untracked working tree files would be overwritten by checkout:\n\tb.ts',
      'untracked-changes-would-be-overwritten',
    ],
    ['error: you need to resolve your current index first', 'conflicts-present'],
    ['fatal: Another git process seems to be running in this repository', 'operation-in-progress'],
    [
      "fatal: 'feature/x' is already checked out at '/path/to/worktree'",
      'branch-in-other-worktree',
    ],
    ["error: pathspec 'nope' did not match any file(s) known to git", 'target-branch-not-found'],
  ]
  for (const [stderr, expected] of cases) {
    it(`classifies ${expected}`, () => {
      const issue = classifySwitchError(stderr)
      assert.equal(issue?.code, expected)
    })
  }

  it('returns request-failed for unknown stderr', () => {
    const issue = classifySwitchError('something unexpected')
    assert.equal(issue?.code, 'request-failed')
  })

  it('returns null for empty stderr', () => {
    assert.equal(classifySwitchError(''), null)
    assert.equal(classifySwitchError('   '), null)
  })

  it('extracts overwrite file paths', () => {
    const stderr =
      'error: Your local changes to the following files would be overwritten by checkout:\n\ta.ts\n\tb.ts\nPlease commit your changes or stash them before you switch branches.\nAborting'
    const issue = classifySwitchError(stderr)
    assert.equal(issue?.code, 'tracked-changes-would-be-overwritten')
    assert.deepEqual(issue?.paths, ['a.ts', 'b.ts'])
  })
})

describe('git-branches real repo integration', () => {
  let dir: string
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-branches-'))
    execFileSync('git', ['init', '-q', '-b', 'main', dir])
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.test'])
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'])
    writeFileSync(join(dir, 'a.txt'), 'a')
    execFileSync('git', ['-C', dir, 'add', 'a.txt'])
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init'])
    execFileSync('git', ['-C', dir, 'branch', 'feature/x'])
    execFileSync('git', ['-C', dir, 'checkout', '-q', '-b', 'feature/y'])
    // commit on feature/y so it diverges from main (a.txt differs after we dirty it)
    writeFileSync(join(dir, 'b.txt'), 'b')
    execFileSync('git', ['-C', dir, 'add', 'b.txt'])
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'y'])
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'main'])
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('listLocalBranches returns current + others', async () => {
    const r = await listLocalBranches(dir)
    assert.equal(r.ok, true)
    assert.equal(r.isRepo, true)
    assert.equal(r.currentBranchName, 'main')
    const names = r.branches.map((b) => b.name).sort()
    assert.deepEqual(names, ['feature/x', 'feature/y', 'main'])
    const cur = r.branches.find((b) => b.name === 'main')
    assert.equal(cur?.isCurrent, true)
  })

  it('switchBranch moves HEAD to target', async () => {
    const r = await switchBranch(dir, 'feature/y')
    assert.equal(r.ok, true)
    assert.equal(r.action, 'switch')
    assert.equal(r.branchName, 'feature/y')
    assert.equal(r.didChange, true)
    const list = await listLocalBranches(dir)
    assert.equal(list.currentBranchName, 'feature/y')
  })

  it('switchBranch to current branch reports didChange=false', async () => {
    // we are on feature/y from previous test
    const r = await switchBranch(dir, 'feature/y')
    assert.equal(r.ok, true)
    assert.equal(r.didChange, false)
  })

  it('switchBranch to missing branch returns target-branch-not-found', async () => {
    const r = await switchBranch(dir, 'does-not-exist')
    assert.equal(r.ok, false)
    assert.ok(r.issues.some((i) => i.code === 'target-branch-not-found'))
  })

  it('switchBranch blocked by dirty tracked file', async () => {
    await switchBranch(dir, 'main')
    // make a.txt dirty in a way that conflicts with feature/y (feature/y has b.txt, main has a.txt='a')
    // Create a conflict: modify a.txt on main, then try switching to feature/y which would need to change it
    writeFileSync(join(dir, 'a.txt'), 'dirty-on-main')
    execFileSync('git', ['-C', dir, 'add', 'a.txt'])
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'dirty main'])
    // now a.txt differs between main and feature/y — modify it uncommitted and switch
    writeFileSync(join(dir, 'a.txt'), 'uncommitted-change')
    const r = await switchBranch(dir, 'feature/y')
    assert.equal(r.ok, false)
    assert.ok(
      r.issues.some(
        (i) =>
          i.code === 'tracked-changes-would-be-overwritten' ||
          i.code === 'untracked-changes-would-be-overwritten',
      ),
    )
    // cleanup: restore
    execFileSync('git', ['-C', dir, 'checkout', '--', 'a.txt'])
  })

  it('createBranchAndSwitch creates + switches', async () => {
    await switchBranch(dir, 'main')
    const r = await createBranchAndSwitch(dir, 'feature/z')
    assert.equal(r.ok, true)
    assert.equal(r.action, 'create')
    assert.equal(r.branchName, 'feature/z')
    const list = await listLocalBranches(dir)
    assert.equal(list.currentBranchName, 'feature/z')
  })

  it('listLocalBranches on non-repo returns ok=false isRepo=false', async () => {
    const noGit = mkdtempSync(join(tmpdir(), 'ra-nogit-'))
    try {
      const r = await listLocalBranches(noGit)
      assert.equal(r.ok, false)
      assert.equal(r.isRepo, false)
    } finally {
      rmSync(noGit, { recursive: true, force: true })
    }
  })
})
