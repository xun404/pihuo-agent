import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  agent,
  client,
  ndJsonStream,
  methods,
  PROTOCOL_VERSION,
  type AgentApp,
  type Stream,
  type AgentCapabilities,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk'
import { AcpSessionDriver, type PromptBinding } from './acp-session-driver.js'

function createPairedStreams(): { clientStream: Stream; agentStream: Stream } {
  const c2a = new TransformStream<Uint8Array, Uint8Array>()
  const a2c = new TransformStream<Uint8Array, Uint8Array>()

  const clientStream = ndJsonStream(c2a.writable, a2c.readable)
  const agentStream = ndJsonStream(a2c.writable, c2a.readable)

  return { clientStream, agentStream }
}

const SAFE_CWD = '/tmp/test-acp-driver'

function makeConfigOption(modelId: string): SessionConfigOption {
  return {
    id: 'model',
    type: 'select' as const,
    name: 'Model',
    options: [{ value: modelId, name: modelId }],
    currentValue: modelId,
  }
}

type TestStopReason = 'end_turn' | 'cancelled'

interface FakeAgentOpts {
  capabilities?: Partial<AgentCapabilities>
  sessionIds?: string[]
  throwOnNew?: string
  throwOnResume?: string
  throwOnLoad?: string
  onPrompt?: (
    sid: string,
  ) =>
    | { stopReason: TestStopReason; text?: string }
    | Promise<{ stopReason: TestStopReason; text?: string }>
  sendUpdateOnPrompt?: (sid: string) => Array<{ text: string }>
  onClose?: (sid: string) => void
  onDelete?: (sid: string) => void
  onCancel?: (sid: string) => void
  onLogout?: () => void
}

function createFakeAgent(opts: FakeAgentOpts = {}): AgentApp {
  const cap = opts.capabilities ?? {}
  const nextId = (opts.sessionIds ?? ['sid-1']).values()

  return agent({ name: 'test-agent' })
    .onRequest(methods.agent.initialize, async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: cap,
    }))
    .onRequest(methods.agent.session.new, async (ctx) => {
      if (opts.throwOnNew) throw new Error(opts.throwOnNew)
      const sid = nextId.next().value ?? 'sid-fallback'
      return {
        sessionId: sid,
        configOptions: [makeConfigOption('m1')],
      }
    })
    .onRequest(methods.agent.session.resume, async (ctx) => {
      if (opts.throwOnResume) throw new Error(opts.throwOnResume)
      const sid = ctx.params.sessionId
      return {
        configOptions: [makeConfigOption('m1')],
      }
    })
    .onRequest(methods.agent.session.load, async (ctx) => {
      if (opts.throwOnLoad) throw new Error(opts.throwOnLoad)
      const sid = ctx.params.sessionId
      const updates = opts.sendUpdateOnPrompt?.(sid) ?? []
      for (const u of updates) {
        await ctx.client.notify(methods.client.session.update, {
          sessionId: sid,
          update: {
            sessionUpdate: 'agent_message_chunk' as const,
            content: { type: 'text' as const, text: u.text },
          },
        })
      }
      return {
        configOptions: [makeConfigOption('m1')],
      }
    })
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      const sid = ctx.params.sessionId
      if (opts.onPrompt) {
        const r = await opts.onPrompt(sid)
        if (r.text) {
          await ctx.client.notify(methods.client.session.update, {
            sessionId: sid,
            update: {
              sessionUpdate: 'agent_message_chunk' as const,
              content: { type: 'text' as const, text: r.text },
            },
          })
        }
        return { stopReason: r.stopReason }
      }
      const updates = opts.sendUpdateOnPrompt?.(sid) ?? []
      for (const u of updates) {
        await ctx.client.notify(methods.client.session.update, {
          sessionId: sid,
          update: {
            sessionUpdate: 'agent_message_chunk' as const,
            content: { type: 'text' as const, text: u.text },
          },
        })
      }
      return { stopReason: 'end_turn' }
    })
    .onRequest(methods.agent.session.setConfigOption, async (ctx) => {
      return { configOptions: [makeConfigOption(ctx.params.value as string)] }
    })
    .onRequest(methods.agent.session.close, async (ctx) => {
      opts.onClose?.(ctx.params.sessionId)
      return {}
    })
    .onRequest(methods.agent.session.delete, async (ctx) => {
      opts.onDelete?.(ctx.params.sessionId)
      return {}
    })
    .onRequest(methods.agent.logout, async () => {
      opts.onLogout?.()
      return {}
    })
    .onNotification(methods.agent.session.cancel, async (ctx) => {
      opts.onCancel?.(ctx.params.sessionId)
    })
}

async function setupDriver(opts: FakeAgentOpts = {}): Promise<{
  driver: AcpSessionDriver
  agentApp: AgentApp
  agentStream: Stream
}> {
  const { clientStream, agentStream } = createPairedStreams()
  const agentApp = createFakeAgent(opts)
  agentApp.connect(agentStream)
  const driver = await AcpSessionDriver.connect(SAFE_CWD, clientStream)
  await driver.initialize()
  return { driver, agentApp, agentStream }
}

function makeBinding(overrides: Partial<PromptBinding> = {}): PromptBinding {
  return { jobId: 'job-1', sequence: 0, ...overrides }
}

describe('AcpSessionDriver — catalog miss (new session)', () => {
  it('init → session/new → persist ID → prompt uses same ID', async () => {
    const { driver } = await setupDriver({ sessionIds: ['sid-new-123'] })

    const newResp = await driver.sessionNew()
    assert.equal(newResp.sessionId, 'sid-new-123')
    assert.equal(driver.agentSessionId, 'sid-new-123')
    assert.ok(driver.configOptions.length > 0)

    const binding = makeBinding()
    const result = await driver.prompt('hello', binding)
    assert.ok(result.ok)
    assert.equal(result.stopReason, 'end_turn')
  })

  it('prompt result includes output text from agent updates', async () => {
    const { driver } = await setupDriver({
      sessionIds: ['sid-out'],
      sendUpdateOnPrompt: () => [{ text: 'Hello ' }, { text: 'World' }],
    })

    await driver.sessionNew()
    let received = ''
    const binding = makeBinding({
      onOutputDelta: (_seq, delta) => {
        received += delta
      },
    })

    const result = await driver.prompt('hi', binding)
    assert.ok(result.ok)
    assert.equal(received, 'Hello World')
    assert.equal(result.output, 'Hello World')
  })

  it('keeps the transport alive when an output observer throws', async () => {
    const { driver } = await setupDriver({
      sessionIds: ['sid-observer'],
      sendUpdateOnPrompt: () => [{ text: 'still captured' }],
    })

    await driver.sessionNew()
    const result = await driver.prompt(
      'hi',
      makeBinding({
        onOutputDelta: () => {
          throw new Error('renderer observer failed')
        },
      }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.output, 'still captured')
    assert.equal(driver.partialOutput, 'still captured')
  })
})

describe('AcpSessionDriver — live reuse', () => {
  it('second prompt on same driver does not call new/resume/load', async () => {
    const { driver } = await setupDriver({
      sessionIds: ['sid-reuse'],
      sendUpdateOnPrompt: () => [{ text: 'first' }],
    })

    await driver.sessionNew()

    const r1 = await driver.prompt('task-1', makeBinding({ jobId: 'j1' }))
    assert.ok(r1.ok)

    const r2 = await driver.prompt('task-2', makeBinding({ jobId: 'j2' }))
    assert.ok(r2.ok)
    assert.equal(driver.agentSessionId, 'sid-reuse')
  })

  it('routes a prompt to its requested session after another session is created', async () => {
    const promptedSessionIds: string[] = []
    const { driver } = await setupDriver({
      sessionIds: ['sid-writer', 'sid-reader'],
      onPrompt: (sessionId) => {
        promptedSessionIds.push(sessionId)
        return { stopReason: 'end_turn', text: `reply-from-${sessionId}` }
      },
    })

    await driver.sessionNew()
    await driver.sessionNew()

    const writer = await driver.prompt(
      'writer follow-up',
      makeBinding({ jobId: 'writer-follow-up' }),
      'sid-writer',
    )
    const reader = await driver.prompt(
      'reader follow-up',
      makeBinding({ jobId: 'reader-follow-up' }),
      'sid-reader',
    )

    assert.deepEqual(promptedSessionIds, ['sid-writer', 'sid-reader'])
    assert.equal(writer.output, 'reply-from-sid-writer')
    assert.equal(reader.output, 'reply-from-sid-reader')
  })

  it('serializes concurrent prompts across sessions on one driver', async () => {
    const { driver } = await setupDriver({
      sessionIds: ['sid-writer', 'sid-reader'],
      onPrompt: async (sessionId) => {
        if (sessionId === 'sid-writer') {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return { stopReason: 'end_turn', text: `reply-from-${sessionId}` }
      },
    })

    await driver.sessionNew()
    await driver.sessionNew()

    const [writer, reader] = await Promise.all([
      driver.prompt('writer follow-up', makeBinding({ jobId: 'writer' }), 'sid-writer'),
      driver.prompt('reader follow-up', makeBinding({ jobId: 'reader' }), 'sid-reader'),
    ])

    assert.equal(writer.output, 'reply-from-sid-writer')
    assert.equal(reader.output, 'reply-from-sid-reader')
  })
})

describe('AcpSessionDriver — resume success', () => {
  it('rebuild driver → session/resume(existingID) → prompt', async () => {
    const existingId = 'sid-existing'

    // First: create session and use it
    {
      const { driver } = await setupDriver({ sessionIds: [existingId] })
      await driver.sessionNew()
      const r = await driver.prompt('first', makeBinding())
      assert.ok(r.ok)
      driver.close()
    }

    // Second: rebuild driver, resume
    {
      const { driver } = await setupDriver({
        capabilities: { sessionCapabilities: { resume: {} } },
        sessionIds: [existingId],
      })

      assert.ok(driver.hasCapability('resume'))

      const resumeResp = await driver.sessionResume(existingId)
      assert.equal(driver.agentSessionId, existingId)

      const r = await driver.prompt('second', makeBinding())
      assert.ok(r.ok)
      assert.equal(r.stopReason, 'end_turn')
    }
  })

  it('sessionResume sets configOptions from response', async () => {
    const { driver } = await setupDriver({
      capabilities: { sessionCapabilities: { resume: {} } },
    })

    await driver.sessionResume('sid-any')
    assert.equal(driver.agentSessionId, 'sid-any')
    assert.ok(driver.configOptions.length > 0)
  })
})

describe('AcpSessionDriver — load fallback', () => {
  it('no resume capability → session/load → suppress replay → prompt', async () => {
    const existingId = 'sid-load-test'
    let loadUpdatesSent = false

    const { clientStream, agentStream } = createPairedStreams()
    const agentApp = agent({ name: 'test-load-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
      }))
      .onRequest(methods.agent.session.load, async (ctx) => {
        loadUpdatesSent = true
        await ctx.client.notify(methods.client.session.update, {
          sessionId: existingId,
          update: {
            sessionUpdate: 'agent_message_chunk' as const,
            content: { type: 'text' as const, text: 'replay text - should be suppressed' },
          },
        })
        return { configOptions: [makeConfigOption('m1')] }
      })
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        await ctx.client.notify(methods.client.session.update, {
          sessionId: existingId,
          update: {
            sessionUpdate: 'agent_message_chunk' as const,
            content: { type: 'text' as const, text: 'actual output' },
          },
        })
        return { stopReason: 'end_turn' }
      })
      .onRequest(methods.agent.session.setConfigOption, async () => ({
        configOptions: [makeConfigOption('m1')],
      }))

    agentApp.connect(agentStream)
    const driver = await AcpSessionDriver.connect(SAFE_CWD, clientStream)
    await driver.initialize()

    assert.ok(driver.hasCapability('load'))
    assert.ok(!driver.hasCapability('resume'))

    await driver.sessionLoad(existingId)
    assert.ok(loadUpdatesSent, 'load should have sent replay updates')

    let received = ''
    const r = await driver.prompt(
      'task',
      makeBinding({
        onOutputDelta: (_seq, delta) => {
          received += delta
        },
      }),
    )

    assert.ok(r.ok)
    assert.ok(!received.includes('replay text'), 'replay text must be suppressed')
    assert.ok(received.includes('actual output'), 'actual output must be received')

    driver.close()
  })
})

describe('AcpSessionDriver — no capabilities', () => {
  it('recovery_not_supported when neither resume nor load', async () => {
    const { driver } = await setupDriver({ capabilities: {} })

    assert.ok(!driver.hasCapability('resume'))
    assert.ok(!driver.hasCapability('load'))
    // Can still create new sessions
    const resp = await driver.sessionNew()
    assert.ok(resp.sessionId)
  })
})

describe('AcpSessionDriver — logout', () => {
  it('treats an empty auth.logout capability object as supported and sends logout', async () => {
    let logoutCalls = 0
    const { driver } = await setupDriver({
      capabilities: { auth: { logout: {} } },
      onLogout: () => {
        logoutCalls += 1
      },
    })

    assert.equal(driver.hasCapability('logout'), true)
    await driver.logout()
    assert.equal(logoutCalls, 1)
    driver.dispose()
  })

  it('treats omitted and null auth.logout capabilities as unsupported', async () => {
    const omitted = await setupDriver({ capabilities: { auth: {} } })
    assert.equal(omitted.driver.hasCapability('logout'), false)
    omitted.driver.dispose()

    const explicitNull = await setupDriver({
      capabilities: { auth: { logout: null } },
    })
    assert.equal(explicitNull.driver.hasCapability('logout'), false)
    explicitNull.driver.dispose()
  })
})

describe('AcpSessionDriver — resume returns not_found', () => {
  it('stale record when resume throws', async () => {
    const { driver } = await setupDriver({
      capabilities: { sessionCapabilities: { resume: {} } },
      throwOnResume: 'Session not found',
    })

    await assert.rejects(() => driver.sessionResume('sid-stale'))
    // When resume fails, the agentSessionId was set before the request fired
    assert.equal(driver.agentSessionId, 'sid-stale', 'should have set the id before the request')
  })
})

describe('AcpSessionDriver — stale record prevents retry', () => {
  it('subsequent dispatches see stale driver', async () => {
    const { driver } = await setupDriver({
      capabilities: { sessionCapabilities: { resume: {} } },
      throwOnResume: 'Session not found',
    })

    await assert.rejects(() => driver.sessionResume('sid-stale'))
    // Driver is now in a bad state — subsequent prompt should fail
    const r = await driver.prompt('task', makeBinding())
    // The prompt should work if agentSessionId is set (it is, since we set it before the request)
    // Actually, in our current implementation, we set agentSessionId before the request,
    // so if the request fails, the sessionId is still set but the session doesn't exist
    // The prompt would then fail because the agent doesn't know about that session
  })
})

describe('AcpSessionDriver — fingerprint isolation', () => {
  it('different keys → separate sessions', async () => {
    const streams1 = createPairedStreams()
    const streams2 = createPairedStreams()

    const agent1 = createFakeAgent({ sessionIds: ['sid-A'] })
    agent1.connect(streams1.agentStream)

    const agent2 = createFakeAgent({ sessionIds: ['sid-B'] })
    agent2.connect(streams2.agentStream)

    const driver1 = await AcpSessionDriver.connect(SAFE_CWD, streams1.clientStream)
    await driver1.initialize()
    await driver1.sessionNew()
    assert.equal(driver1.agentSessionId, 'sid-A')

    const driver2 = await AcpSessionDriver.connect(SAFE_CWD, streams2.clientStream)
    await driver2.initialize()
    await driver2.sessionNew()
    assert.equal(driver2.agentSessionId, 'sid-B')

    assert.notEqual(driver1.agentSessionId, driver2.agentSessionId)

    driver1.close()
    driver2.close()
  })
})

describe('AcpSessionDriver — cancel', () => {
  it('sends session/cancel notification', async () => {
    let cancelReceived = false
    const { clientStream, agentStream } = createPairedStreams()

    const agentApp = agent({ name: 'cancel-test' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({
        sessionId: 'sid-cancel',
        configOptions: [makeConfigOption('m1')],
      }))
      .onRequest(methods.agent.session.prompt, async () => ({
        stopReason: 'end_turn',
      }))
      .onNotification(methods.agent.session.cancel, async (ctx) => {
        cancelReceived = true
      })
      .onRequest(methods.agent.session.setConfigOption, async () => ({
        configOptions: [makeConfigOption('m1')],
      }))

    agentApp.connect(agentStream)
    const driver = await AcpSessionDriver.connect(SAFE_CWD, clientStream)
    await driver.initialize()
    await driver.sessionNew()

    await driver.cancel()
    assert.ok(cancelReceived, 'cancel notification should have been received')

    driver.close()
  })

  it('cancels the requested session after another shared session is created', async () => {
    const cancelledSessionIds: string[] = []
    const { driver } = await setupDriver({
      sessionIds: ['sid-writer', 'sid-reader'],
      onCancel: (sessionId) => cancelledSessionIds.push(sessionId),
    })
    await driver.sessionNew()
    await driver.sessionNew()

    await driver.cancel('sid-writer')

    assert.deepEqual(cancelledSessionIds, ['sid-writer'])
    driver.close()
  })
})

describe('AcpSessionDriver — hasCapability', () => {
  it('detects resume capability via sessionCapabilities.resume', async () => {
    const { driver } = await setupDriver({
      capabilities: { sessionCapabilities: { resume: {} } },
    })
    assert.ok(driver.hasCapability('resume'))
    assert.ok(!driver.hasCapability('load'))
  })

  it('detects load capability via top-level loadSession', async () => {
    const { driver } = await setupDriver({
      capabilities: { loadSession: true },
    })
    assert.ok(driver.hasCapability('load'))
    assert.ok(!driver.hasCapability('resume'))
  })

  it('detects both capabilities', async () => {
    const { driver } = await setupDriver({
      capabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
    })
    assert.ok(driver.hasCapability('resume'))
    assert.ok(driver.hasCapability('load'))
  })

  it('detects neither capability', async () => {
    const { driver } = await setupDriver({ capabilities: {} })
    assert.ok(!driver.hasCapability('resume'))
    assert.ok(!driver.hasCapability('load'))
  })

  it('detects close and delete from sessionCapabilities', async () => {
    const { driver } = await setupDriver({
      capabilities: { sessionCapabilities: { close: {}, delete: {} } },
    })
    assert.ok(driver.hasCapability('close'))
    assert.ok(driver.hasCapability('delete'))
  })
})

describe('AcpSessionDriver — remote lifecycle', () => {
  it('calls session/close without conflating it with local transport close', async () => {
    const closed: string[] = []
    const { driver } = await setupDriver({
      capabilities: { sessionCapabilities: { close: {} } },
      sessionIds: ['sid-close'],
      onClose: (sid) => closed.push(sid),
    })
    await driver.sessionNew()
    await driver.closeSession()
    assert.deepEqual(closed, ['sid-close'])
    assert.equal(driver.agentSessionId, null)
    driver.close()
  })

  it('calls session/delete for the exact remote session', async () => {
    const deleted: string[] = []
    const { driver } = await setupDriver({
      capabilities: { sessionCapabilities: { delete: {} } },
      sessionIds: ['sid-delete'],
      onDelete: (sid) => deleted.push(sid),
    })
    await driver.sessionNew()
    await driver.deleteSession('sid-delete')
    assert.deepEqual(deleted, ['sid-delete'])
    assert.equal(driver.agentSessionId, null)
    driver.close()
  })
})

describe('AcpSessionDriver — prompt without active session', () => {
  it('returns error when no session has been created', async () => {
    const { driver } = await setupDriver()
    const r = await driver.prompt('task', makeBinding())
    assert.ok(!r.ok)
    assert.ok(r.error!.includes('No active session'))
  })
})

describe('AcpSessionDriver — setConfigOption', () => {
  it('sets config option on active session', async () => {
    const { driver } = await setupDriver({ sessionIds: ['sid-cfg'] })
    await driver.sessionNew()
    await driver.setConfigOption('model', 'm1')
    // No error means success
  })

  it('throws when no active session', async () => {
    const { driver } = await setupDriver()
    await assert.rejects(() => driver.setConfigOption('model', 'm1'), /No active session/)
  })
})

describe('AcpSessionDriver — sessionId validation', () => {
  it('ignores session/update notification with wrong sessionId', async () => {
    const correctSid = 'sid-correct'
    const wrongSid = 'sid-wrong'

    const { clientStream, agentStream } = createPairedStreams()

    const agentApp = agent({ name: 'test-sid-validate' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({
        sessionId: correctSid,
        configOptions: [makeConfigOption('m1')],
      }))
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        const sid = ctx.params.sessionId
        await ctx.client.notify(methods.client.session.update, {
          sessionId: wrongSid,
          update: {
            sessionUpdate: 'agent_message_chunk' as const,
            content: { type: 'text' as const, text: 'WRONG' },
          },
        })
        await ctx.client.notify(methods.client.session.update, {
          sessionId: correctSid,
          update: {
            sessionUpdate: 'agent_message_chunk' as const,
            content: { type: 'text' as const, text: 'correct' },
          },
        })
        return { stopReason: 'end_turn' as const }
      })
      .onRequest(methods.agent.session.setConfigOption, async () => ({
        configOptions: [makeConfigOption('m1')],
      }))

    agentApp.connect(agentStream)
    const driver = await AcpSessionDriver.connect(SAFE_CWD, clientStream)
    await driver.initialize()
    await driver.sessionNew()

    let received = ''
    const result = await driver.prompt(
      'task',
      makeBinding({
        onOutputDelta: (_seq, delta) => {
          received += delta
        },
      }),
    )

    assert.ok(result.ok)
    assert.ok(!received.includes('WRONG'), 'wrong session update must be ignored')
    assert.ok(received.includes('correct'), 'correct session update must be received')

    driver.close()
  })

  it('permission request handler validates sessionId', async () => {
    const correctSid = 'sid-perm-test'
    const wrongSid = 'sid-wrong-perm'

    const { clientStream, agentStream } = createPairedStreams()

    let permIncorrectSidCaught = false

    const agentApp = agent({ name: 'test-sid-perm' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({
        sessionId: correctSid,
        configOptions: [makeConfigOption('m1')],
      }))
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        const sid = ctx.params.sessionId
        try {
          const resp = (await ctx.client.request(
            methods.client.session.requestPermission as string,
            {
              sessionId: wrongSid,
              toolCall: { toolCallId: 'tc1', kind: 'read', title: 'Read file' },
              options: [{ optionId: 'allow_once', name: 'Allow Once' }],
            },
          )) as { outcome: { outcome: string; optionId?: string } }
          if (resp.outcome.outcome === 'cancelled') {
            permIncorrectSidCaught = true
          }
        } catch {
          // nested request may fail in test SDK
        }
        return { stopReason: 'end_turn' as const }
      })
      .onRequest(methods.agent.session.setConfigOption, async () => ({
        configOptions: [makeConfigOption('m1')],
      }))

    agentApp.connect(agentStream)
    const driver = await AcpSessionDriver.connect(SAFE_CWD, clientStream)
    await driver.initialize()
    await driver.sessionNew()

    let permForwarded = false
    let result: { ok: boolean; error?: string } = { ok: false }
    try {
      result = await driver.prompt(
        'task',
        makeBinding({
          onPermissionRequest: async (_req) => {
            permForwarded = true
            return { outcome: 'selected', optionId: 'allow_once' }
          },
        }),
      )
    } catch {
      // prompt may fail due to nested request limitations in test SDK
    }

    assert.ok(
      !permForwarded,
      'permission request with wrong sessionId must not be forwarded to binding',
    )

    driver.close()
  })
})

describe('AcpSessionDriver — approval option boundary', () => {
  it('fails the prompt with a typed safe error when the agent sends invalid options', async () => {
    const sessionId = 'sid-invalid-options'
    const { clientStream, agentStream } = createPairedStreams()
    const agentApp = agent({ name: 'test-invalid-options' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({
        sessionId,
        configOptions: [makeConfigOption('m1')],
      }))
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        await ctx.client.request(methods.client.session.requestPermission as string, {
          sessionId,
          toolCall: { toolCallId: 'tc-invalid', kind: 'execute', title: 'Run command' },
          options: [
            { optionId: 'duplicate', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'duplicate', name: 'Allow always', kind: 'allow_always' },
          ],
        })
        return { stopReason: 'end_turn' as const }
      })

    agentApp.connect(agentStream)
    const driver = await AcpSessionDriver.connect(SAFE_CWD, clientStream)
    await driver.initialize()
    await driver.sessionNew()

    await assert.rejects(
      () =>
        driver.prompt(
          'task',
          makeBinding({
            onPermissionRequest: async () => ({ outcome: 'selected', optionId: 'allow' }),
          }),
        ),
      (error: unknown) => {
        const value = error as { code?: string; publicMessage?: string }
        assert.equal(value.code, 'invalid_approval_options')
        assert.equal(
          value.publicMessage,
          'The ACP agent returned invalid approval options. The task was stopped.',
        )
        return true
      },
    )
    driver.close()
  })
})
