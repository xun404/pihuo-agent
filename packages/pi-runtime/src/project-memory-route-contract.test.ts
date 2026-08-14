import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const owner = readFileSync(new URL('./http-server.ts', import.meta.url), 'utf8')
const startLeaderChat = readFileSync(new URL('./leader/start-leader-chat.ts', import.meta.url), 'utf8')

describe('project memory route contract', () => {
  it('keeps GET/PATCH/working PUT routes present on the Owner API', () => {
    assert.match(owner, /match\(path, '\/api\/projects\/:id\/memory'\)/u)
    assert.match(owner, /match\(path, '\/api\/projects\/:id\/memory\/working'\)/u)
    assert.match(owner, /PROJECT_MEMORY_SESSION_REQUIRED/u)
    assert.match(owner, /PROJECT_MEMORY_SESSION_NOT_FOUND/u)
    assert.match(owner, /PROJECT_MEMORY_CONTENT_TOO_LARGE/u)
    assert.match(owner, /resolveProjectMemoryContext/u)
    assert.match(owner, /setProjectMemoryEnabled/u)
    assert.match(owner, /updateProjectWorkingMemory/u)
  })

  it('does not trust client resource ids for chat memory options', () => {
    assert.match(startLeaderChat, /projectMemoryPrompt\(/u)
    assert.match(startLeaderChat, /isProjectMemoryEnabled\(scope\.routerProject\)/u)
    assert.doesNotMatch(startLeaderChat, /body\.resourceId/u)
  })

  it('keeps semantic recall disabled and exposes stable mutation errors', () => {
    const service = readFileSync(new URL('./project-memory.ts', import.meta.url), 'utf8')
    assert.match(service, /semanticRecall:\s*false/u)
    assert.match(service, /workingMemory:\s*\{[\s\S]*scope:\s*'resource'/u)
    assert.match(owner, /PROJECT_MEMORY_ENABLED_REQUIRED/u)
    assert.match(owner, /PROJECT_MEMORY_UPDATE_FAILED/u)
  })
})
