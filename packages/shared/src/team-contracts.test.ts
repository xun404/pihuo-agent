import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('Team shared contracts', () => {
  it('defines Team members and global Team templates', () => {
    assert.match(source, /export interface TeamMember\s*\{/u)
    assert.match(source, /export interface TeamTemplate\s*\{/u)
    assert.match(source, /export interface TeamTemplateMember\s*\{/u)
    assert.match(source, /preferredWorkerId:\s*string/u)
  })

  it('stores only a default role type on each Worker', () => {
    assert.match(source, /defaultRoleType:\s*WorkerRole/u)
    assert.doesNotMatch(source, /export interface WorkerDefaultRole/u)
    assert.doesNotMatch(source, /defaultRole\??:\s*WorkerDefaultRole/u)
  })

  it('exposes Team state and Team member Job snapshots without legacy role definitions', () => {
    assert.match(source, /teamRevision:\s*number/u)
    assert.match(source, /teamMembers:\s*TeamMember\[\]/u)
    assert.match(source, /teamTemplates:\s*TeamTemplate\[\]/u)
    assert.match(source, /teamMemberId\??:\s*string/u)
    assert.doesNotMatch(source, /export interface RoleDefinition/u)
    assert.doesNotMatch(source, /roleDefinitions:\s*RoleDefinition\[\]/u)
  })
})
