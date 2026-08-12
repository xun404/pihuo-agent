import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rootSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const workerAcpSource = readFileSync(new URL('./contracts/worker-acp.ts', import.meta.url), 'utf8')
const workerSource = readFileSync(new URL('./contracts/worker.ts', import.meta.url), 'utf8')
const chatJobsSource = readFileSync(new URL('./contracts/chat-jobs.ts', import.meta.url), 'utf8')
const teamSource = readFileSync(new URL('./contracts/team.ts', import.meta.url), 'utf8')
const appSnapshotSource = readFileSync(new URL('./contracts/app-snapshot.ts', import.meta.url), 'utf8')
const source = `${rootSource}\n${workerAcpSource}\n${workerSource}\n${chatJobsSource}\n${teamSource}\n${appSnapshotSource}`

describe('Team shared contracts', () => {
  it('defines Team members and global Team templates', () => {
    assert.match(source, /export interface TeamMember\s*\{/u)
    assert.match(source, /export interface TeamTemplate\s*\{/u)
    assert.match(source, /export interface TeamTemplateMember\s*\{/u)
    assert.match(source, /preferredWorkerId:\s*string/u)
  })

  it('supports optional reasoning fields on Worker, TeamMember, Job, and template mapping', () => {
    assert.match(source, /export interface WorkerReasoningOption\s*\{/u)
    assert.match(source, /export interface WorkerReasoningSelector\s*\{/u)
    assert.match(source, /export interface WorkerReasoningCatalogEntry\s*\{/u)
    // WorkerRegistration optional reasoning field
    assert.match(source, /reasoning\?\s*:\s*string/u)
    // TeamMember optional reasoning override
    assert.match(source, /TeamMember\s*\{.*reasoning\?\s*:/su)
    // WorkerJob.effectiveReasoning
    assert.match(source, /effectiveReasoning\?\s*:\s*string/u)
    // TeamTemplateMemberMapping reasoning
    assert.match(source, /TeamTemplateMemberMapping\s*\{.*reasoning\?\s*:/su)
    // REASONING_MAPPING_REQUIRED issue code
    assert.match(source, /REASONING_MAPPING_REQUIRED/u)
    // ACP reasoning error codes
    assert.match(source, /ACP_REASONING_UNSUPPORTED/u)
    assert.match(source, /ACP_REASONING_VALUE_UNAVAILABLE/u)
    assert.match(source, /ACP_REASONING_CONFIGURATION_FAILED/u)
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
