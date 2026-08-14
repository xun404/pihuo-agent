import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const owner = readFileSync(new URL('./http-server.ts', import.meta.url), 'utf8')

function sessionCreateBlock(source: string): string {
  const start = source.indexOf("if (method === 'POST' && path === '/api/sessions')")
  assert.notEqual(start, -1)
  return source.slice(start, start + 2_500)
}

test('Owner resolves a selected Team template before Session creation', () => {
  for (const source of [owner]) {
    const block = sessionCreateBlock(source)
    assert.match(block, /teamTemplateId/u)
    assert.match(block, /resolveForProject/u)
    assert.match(block, /initialTeamMembers/u)
    assert.ok(block.indexOf('resolveForProject') < block.indexOf('createSession'))
  }
})

test('Owner atomically passes permissionMode into Session creation', () => {
  for (const source of [owner]) {
    const block = sessionCreateBlock(source)
    assert.match(block, /permissionMode\?: SessionPermissionMode/u)
    assert.match(block, /permissionMode: body\.permissionMode/u)
    assert.ok(block.indexOf('permissionMode: body.permissionMode') < block.indexOf('snapshot'))
  }
})

test('Session creation maps template failures to stable public codes', () => {
  for (const source of [owner]) {
    const block = sessionCreateBlock(source)
    assert.match(block, /TeamTemplateServiceError/u)
    assert.match(block, /TEAM_TEMPLATE_NOT_FOUND/u)
    assert.match(block, /TEAM_TEMPLATE_MAPPING_REQUIRED/u)
  }
})
