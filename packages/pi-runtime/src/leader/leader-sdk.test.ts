import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  sessionEntryToContextMessages,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createLeaderEventStream } from './leader-chat-stream.js'
import { clearLeaderTasks, createTaskTools, getLeaderTasks } from './task-tools.js'

it(
  'streams reasoning, executes a PiHuo tool, and restores a session with the current Pi SDK',
  { timeout: 20_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pihuo-pi-sdk-'))
    const thread = 'sdk-integration'
    let requests = 0
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* Drain the local fixture request. */
      }
      requests += 1
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const chunk = (delta: object, finish: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({
            id: `fixture-${requests}`,
            object: 'chat.completion.chunk',
            created: 1,
            model: 'fixture',
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`,
        )
      chunk({ role: 'assistant' })
      if (requests === 1) {
        chunk({ reasoning_content: 'Record the coordination task.' })
        chunk({
          tool_calls: [
            {
              index: 0,
              id: 'call-task',
              type: 'function',
              function: {
                name: 'task-write',
                arguments: JSON.stringify({
                  id: 'task-1',
                  content: 'Verify the SDK',
                  status: 'completed',
                }),
              },
            },
          ],
        })
        chunk({}, 'tool_calls')
      } else {
        chunk({ content: 'SDK fixture complete.' })
        chunk({}, 'stop')
      }
      response.end('data: [DONE]\n\n')
    })
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const runtime = await ModelRuntime.create({
        authPath: join(root, 'auth.json'),
        modelsPath: join(root, 'models.json'),
        allowModelNetwork: false,
        refreshOnCreate: false,
      })
      runtime.registerProvider('pihuo-fixture', {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: 'openai-completions',
        models: [
          {
            id: 'fixture',
            name: 'Fixture',
            reasoning: true,
            input: ['text'],
            contextWindow: 32_000,
            maxTokens: 1024,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      })
      await runtime.setRuntimeApiKey('pihuo-fixture', 'local-fixture-key')
      const settings = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      })
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir: root,
        settingsManager: settings,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noContextFiles: true,
      })
      await loader.reload()
      const model = runtime.getModel('pihuo-fixture', 'fixture')
      assert.ok(model)
      const path = join(root, 'session.jsonl')
      const created = await createAgentSession({
        cwd: root,
        agentDir: root,
        modelRuntime: runtime,
        model,
        tools: ['task-write'],
        noTools: 'builtin',
        customTools: createTaskTools(thread),
        settingsManager: settings,
        resourceLoader: loader,
        sessionManager: SessionManager.open(path, root, root),
      })
      session = created.session
      const reader = createLeaderEventStream({
        session,
        text: 'Record one task.',
        mode: 'prompt',
        abortSignal: new AbortController().signal,
        modelId: 'pihuo-fixture/fixture',
      }).getReader()
      const events = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        events.push(value)
      }
      assert.equal(requests, 2)
      assert.deepEqual(
        getLeaderTasks(thread).map((task) => task.id),
        ['task-1'],
      )
      assert.ok(events.some((event) => event.type === 'tool_end' && !event.isError))
      assert.ok(
        events.some(
          (event) =>
            event.type === 'message_update' &&
            JSON.stringify(event.message.content).includes('SDK fixture complete.'),
        ),
      )
      assert.ok(
        events.some(
          (event) =>
            event.type === 'message_update' &&
            JSON.stringify(event.message.content).includes('Record the coordination task.'),
        ),
      )
      const restored = SessionManager.open(path)
        .buildContextEntries()
        .flatMap(sessionEntryToContextMessages)
      assert.ok(JSON.stringify(restored).includes('SDK fixture complete.'))
      assert.equal(
        events.some((event) => event.type === 'error'),
        false,
      )
      assert.ok(
        session.messages.some(
          (message) => message.role === 'custom' && message.customType === 'leader-run-meta',
        ),
      )
    } finally {
      session?.dispose()
      clearLeaderTasks(thread)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
)
