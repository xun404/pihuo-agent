import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const owner = readFileSync(new URL('./http-server.ts', import.meta.url), 'utf8')
const studio = readFileSync(new URL('./routes/api.ts', import.meta.url), 'utf8')
const chatRunHttp = readFileSync(new URL('./chat-run-http.ts', import.meta.url), 'utf8')

describe('project memory route contract', () => {
  it('keeps GET/PATCH/working PUT routes present on both API surfaces', () => {
    assert.match(owner, /match\(path, '\/api\/projects\/:id\/memory'\)/u)
    assert.match(owner, /match\(path, '\/api\/projects\/:id\/memory\/working'\)/u)
    assert.match(studio, /registerApiRoute\('\/api\/projects\/:id\/memory'/u)
    assert.match(studio, /registerApiRoute\('\/api\/projects\/:id\/memory\/working'/u)
    for (const source of [owner, studio]) {
      assert.match(source, /PROJECT_MEMORY_SESSION_REQUIRED/u)
      assert.match(source, /PROJECT_MEMORY_SESSION_NOT_FOUND/u)
      assert.match(source, /PROJECT_MEMORY_CONTENT_TOO_LARGE/u)
      assert.match(source, /resolveProjectMemoryContext/u)
      assert.match(source, /setProjectMemoryEnabled/u)
      assert.match(source, /updateProjectWorkingMemory/u)
    }
  })

  it('does not trust client resource ids for chat memory options', () => {
    assert.match(
      chatRunHttp,
      /projectMemoryOptions:\s*resolveProjectMemoryOptions\(isProjectMemoryEnabled\(routerProject\)\)/u,
    )
    assert.match(owner, /options: projectMemoryOptions/u)
    assert.match(owner, /persistUserTurnUpFront\(leaderMemory/u)
  })

  it('keeps semantic recall disabled and exposes stable mutation errors', () => {
    const service = readFileSync(new URL('./project-memory.ts', import.meta.url), 'utf8')
    assert.match(service, /semanticRecall:\s*false/u)
    assert.match(service, /workingMemory:\s*\{[\s\S]*scope:\s*'resource'/u)
    for (const source of [owner, studio]) {
      assert.match(source, /PROJECT_MEMORY_ENABLED_REQUIRED/u)
      assert.match(source, /PROJECT_MEMORY_UPDATE_FAILED/u)
    }
  })
})
