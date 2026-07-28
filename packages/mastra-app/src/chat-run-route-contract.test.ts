import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('Chat resume/abort route contract', () => {
  const source = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')

  it('serves GET /chat/:agentId/:chatId/stream for AI SDK resumeStream (204 when idle)', () => {
    assert.match(source, /match\(path, '\/chat\/:agentId\/:chatId\/stream'\)/u)
    const start = source.indexOf("match(path, '/chat/:agentId/:chatId/stream')")
    const route = source.slice(start, source.indexOf("match(path, '/chat/:agentId/:chatId/abort')"))
    assert.match(route, /method === 'GET'/u)
    assert.match(route, /getChatRun\(/u)
    assert.match(route, /writeHead\(204/u)
    assert.match(route, /attachChatRunSubscriber\(/u)
  })

  it('serves POST /chat/:agentId/:chatId/abort so stop() cancels the server run', () => {
    assert.match(source, /match\(path, '\/chat\/:agentId\/:chatId\/abort'\)/u)
    const start = source.indexOf("match(path, '/chat/:agentId/:chatId/abort')")
    const route = source.slice(start, start + 400)
    assert.match(route, /method === 'POST'/u)
    assert.match(route, /abortChatRun\(/u)
  })

  it('POST /chat/:agentId runs through the hub with an abort signal, not a raw pipe', () => {
    assert.match(source, /registerChatRun\(threadId, stream, abortController\)/u)
    assert.match(source, /attachChatRunSubscriber\(hub, res, corsFor\(\)\)/u)
    assert.match(source, /abortSignal: abortController\.signal/u)
    assert.doesNotMatch(source, /pipeUIMessageStreamToResponse/u)
  })

  it('POST /chat/:agentId pre-saves the user turn so mid-run reloads keep it', () => {
    const start = source.indexOf("match(path, '/chat/:agentId')")
    const route = source.slice(start, start + 12000)
    assert.match(route, /persistUserTurnUpFront\(leaderMemory as never, \{/u)
    assert.match(route, /messages: params\.messages/u)
    // Best-effort: pre-save failure must not break the chat flow.
    assert.match(route, /pre-save failed \(non-fatal\)/u)
  })

  it('keeps the resume/abort routes behind the desktop /chat/ auth gate', () => {
    const gate = source.indexOf("path.startsWith('/chat/')")
    const streamRoute = source.indexOf("match(path, '/chat/:agentId/:chatId/stream')")
    const abortRoute = source.indexOf("match(path, '/chat/:agentId/:chatId/abort')")
    assert.ok(gate > 0 && streamRoute > gate && abortRoute > gate)
  })
})
