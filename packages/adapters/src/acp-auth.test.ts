import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RequestError } from '@agentclientprotocol/sdk'
import { isAuthRequiredError, sanitizeAuthMethods, toPublicAuthMethodSummary } from './acp-auth.js'

describe('isAuthRequiredError', () => {
  it('accepts only RequestError code=-32000 with data.reason=auth_required', () => {
    assert.equal(isAuthRequiredError(RequestError.authRequired({ reason: 'auth_required' })), true)
    assert.equal(
      isAuthRequiredError(
        new RequestError(-32000, 'Authentication required', { reason: 'auth_required' }),
      ),
      true,
    )
  })

  it('rejects message-only or wrong code errors', () => {
    assert.equal(isAuthRequiredError(new Error('Authentication required')), false)
    assert.equal(isAuthRequiredError(new Error('auth_required')), false)
    assert.equal(
      isAuthRequiredError(new RequestError(-32000, 'Authentication required', { reason: 'other' })),
      false,
    )
    assert.equal(
      isAuthRequiredError(new RequestError(-32603, 'Internal', { reason: 'auth_required' })),
      false,
    )
    assert.equal(isAuthRequiredError(new RequestError(-32000, 'x', null)), false)
  })
})

describe('sanitizeAuthMethods', () => {
  it('sanitizes agent / terminal / env_var and marks unknown unsupported', () => {
    const methods = sanitizeAuthMethods([
      { id: 'oauth', name: 'Browser OAuth' },
      {
        type: 'terminal',
        id: 'login',
        name: 'CLI Login',
        args: ['auth', 'login'],
        env: { NO_COLOR: '1' },
      },
      {
        type: 'env_var',
        id: 'api-key',
        name: 'API Key',
        vars: [{ name: 'OPENAI_API_KEY', secret: true }],
        link: 'https://example.com/keys',
      },
      {
        type: 'magic' as 'agent',
        id: 'x',
        name: 'Magic',
      } as never,
    ])
    assert.equal(methods.length, 4)
    assert.equal(methods[0]!.type, 'agent')
    assert.equal(methods[1]!.type, 'terminal')
    assert.deepEqual(methods[1]!.terminalArgs, ['auth', 'login'])
    assert.deepEqual(methods[1]!.terminalEnvKeys, ['NO_COLOR'])
    assert.deepEqual(methods[1]!.terminalEnv, { NO_COLOR: '1' })
    assert.equal(methods[2]!.type, 'env_var')
    assert.deepEqual(methods[2]!.envVarNames, ['OPENAI_API_KEY'])
    assert.equal(methods[3]!.type, 'unsupported')
  })

  it('skips empty ids', () => {
    assert.deepEqual(sanitizeAuthMethods([{ id: '  ', name: 'x' } as never]), [])
  })

  it('bounds untrusted method count and marks malformed terminal methods unsupported', () => {
    const methods = sanitizeAuthMethods([
      {
        type: 'terminal',
        id: 'malformed',
        name: 'Malformed',
        args: ['ok', `bad\u0000arg`],
      },
      ...Array.from({ length: 30 }, (_, index) => ({
        id: `method-${index}`,
        name: `Method ${index}`,
      })),
    ] as never)

    assert.ok(methods.length <= 16)
    assert.equal(methods[0]?.type, 'unsupported')
    assert.ok(methods.every((method) => method.id.length <= 128))
  })

  it('never retains terminal control variables or secret-looking env entries', () => {
    for (const env of [
      { SWARMDESK_AGENT_API_TOKEN: 'not-a-secret-value' },
      { MASTRA_STUDIO_TOKEN: 'not-a-secret-value' },
      { ELECTRON_RUN_AS_NODE: '1' },
      { NODE_OPTIONS: '--require attacker.js' },
      { SAFE_NAME: 'Bearer abcdefghijklmnopqrstuvwxyz' },
      { SAFE_NAME: 'sk-proj-0123456789abcdefghijklmnop' },
      { API_KEY: 'plain' },
      { BASH_ENV: '/tmp/hook' },
      { PYTHONPATH: '/tmp/hijack' },
      { PYTHONHOME: '/tmp/runtime' },
      { RUBYOPT: '-r/tmp/hook' },
      { NPM_CONFIG_USERCONFIG: '/tmp/npmrc' },
    ]) {
      const [method] = sanitizeAuthMethods([
        {
          type: 'terminal',
          id: 'login',
          name: 'Login',
          args: ['auth'],
          env,
        },
      ] as never)
      assert.equal(method?.type, 'unsupported')
      assert.equal(method?.terminalEnv, undefined)
      assert.equal(method?.terminalArgs, undefined)
    }
  })

  it('rejects invalid env_var names and keeps only bounded validated names', () => {
    const [method] = sanitizeAuthMethods([
      {
        type: 'env_var',
        id: 'api-key',
        name: 'API Key',
        vars: [{ name: 'VALID_API_KEY' }, { name: 'BAD-NAME' }],
      },
    ] as never)
    assert.equal(method?.type, 'unsupported')
    assert.equal(method?.envVarNames, undefined)
  })

  it('public projection never exposes terminal env values, args, or links', () => {
    const methods = sanitizeAuthMethods([
      {
        type: 'terminal',
        id: 'login',
        name: 'Login',
        args: ['auth', 'login'],
        env: { NO_COLOR: '1' },
      },
    ] as never)
    const json = JSON.stringify(toPublicAuthMethodSummary(methods))
    assert.equal(json.includes('NO_COLOR'), false)
    assert.equal(json.includes('auth'), false)
  })

  it('marks oversized text, URL, args, and env values unsupported without retaining them', () => {
    const huge = 'x'.repeat(10_000)
    const methods = sanitizeAuthMethods([
      { id: 'long-name', name: huge },
      {
        type: 'env_var',
        id: 'long-link',
        name: 'Link',
        vars: [],
        link: `https://example.com/${huge}`,
      },
      { type: 'terminal', id: 'long-arg', name: 'Arg', args: [huge], env: {} },
      { type: 'terminal', id: 'long-env', name: 'Env', args: [], env: { NO_COLOR: huge } },
    ] as never)
    assert.deepEqual(
      methods.map((method) => method.type),
      ['unsupported', 'unsupported', 'unsupported', 'unsupported'],
    )
    assert.equal(JSON.stringify(methods).includes(huge), false)
  })

  it('rejects duplicate authentication method IDs as ambiguous', () => {
    const methods = sanitizeAuthMethods([
      { type: 'terminal', id: 'same', name: 'Terminal', args: ['login'] },
      { id: 'same', name: 'Agent' },
    ] as never)
    assert.equal(methods.length, 2)
    assert.ok(methods.every((method) => method.type === 'unsupported'))
  })
})
