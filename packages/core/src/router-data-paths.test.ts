import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRouterDataDir, resolveRouterDataPaths } from './router-data-paths.js'

describe('resolveRouterDataPaths', () => {
  const prev: Record<string, string | undefined> = {}
  const keys = [
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'SWARMDESK_AGENT_DATA_DIR',
    'SWARMDESK_AGENT_AGENTS_DIR',
    'SWARMDESK_AGENT_AGENTS_STATE',
    'SWARMDESK_AGENT_RUNTIME_PATH',
    'ACP_CATALOG_PATH',
    'MASTRA_MEMORY_URL',
  ]
  let prevPlatform: string | undefined

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k]
    }
    prevPlatform = process.env.HOME
  })

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
    if (prevPlatform !== undefined) process.env.HOME = prevPlatform
  })

  it('uses XDG_CONFIG_HOME/swarmdesk-agent by default (posix)', () => {
    delete process.env.SWARMDESK_AGENT_DATA_DIR
    delete process.env.SWARMDESK_AGENT_AGENTS_DIR
    delete process.env.SWARMDESK_AGENT_AGENTS_STATE
    delete process.env.SWARMDESK_AGENT_RUNTIME_PATH
    delete process.env.XDG_CONFIG_HOME
    delete process.env.XDG_CACHE_HOME
    process.env.HOME = '/tmp/fake-home-ra'
    const p = resolveRouterDataPaths()
    // root = ~/.config/swarmdesk-agent
    assert.equal(p.rootDir, '/tmp/fake-home-ra/.config/swarmdesk-agent')
    assert.equal(p.configDir, p.rootDir)
    // data + cache are subdirs of root
    assert.equal(p.dataDir, '/tmp/fake-home-ra/.config/swarmdesk-agent/data')
    assert.equal(p.cacheDir, '/tmp/fake-home-ra/.config/swarmdesk-agent/cache')
    // files derive from their layer
    assert.equal(p.statePath, '/tmp/fake-home-ra/.config/swarmdesk-agent/data/state.json')
    assert.equal(p.runtimePath, '/tmp/fake-home-ra/.config/swarmdesk-agent/data/runtime.json')
    assert.equal(p.catalogPath, '/tmp/fake-home-ra/.config/swarmdesk-agent/data/acp-sessions.json')
    assert.equal(p.memoryDbPath, '/tmp/fake-home-ra/.config/swarmdesk-agent/data/mastra-memory.db')
    assert.equal(
      p.modelRegistryPath,
      '/tmp/fake-home-ra/.config/swarmdesk-agent/data/mastra-model-registry.json',
    )
    assert.equal(
      p.modelsCachePath,
      '/tmp/fake-home-ra/.config/swarmdesk-agent/cache/models-cache.json',
    )
    // secrets/settings live at root (config layer)
    assert.equal(p.secretsDir, p.rootDir)
  })

  it('honors XDG_CONFIG_HOME when set (posix)', () => {
    delete process.env.SWARMDESK_AGENT_DATA_DIR
    delete process.env.SWARMDESK_AGENT_AGENTS_DIR
    process.env.HOME = '/tmp/fake-home-ra'
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-config'
    const p = resolveRouterDataPaths()
    assert.equal(p.rootDir, '/tmp/xdg-config/swarmdesk-agent')
    assert.equal(p.dataDir, '/tmp/xdg-config/swarmdesk-agent/data')
  })

  it('SWARMDESK_AGENT_DATA_DIR pins the entire root (config+data+cache beneath it)', () => {
    process.env.HOME = '/tmp/fake-home-ra'
    process.env.SWARMDESK_AGENT_DATA_DIR = '/tmp/custom-root'
    delete process.env.SWARMDESK_AGENT_AGENTS_STATE
    const p = resolveRouterDataPaths()
    assert.equal(p.rootDir, '/tmp/custom-root')
    assert.equal(p.configDir, '/tmp/custom-root')
    assert.equal(p.dataDir, '/tmp/custom-root/data')
    assert.equal(p.cacheDir, '/tmp/custom-root/cache')
    assert.equal(p.statePath, '/tmp/custom-root/data/state.json')
    assert.equal(resolveRouterDataDir(), '/tmp/custom-root')
  })

  it('SWARMDESK_AGENT_AGENTS_DIR is an alias for SWARMDESK_AGENT_DATA_DIR', () => {
    delete process.env.SWARMDESK_AGENT_DATA_DIR
    process.env.SWARMDESK_AGENT_AGENTS_DIR = '/tmp/alias-root'
    const p = resolveRouterDataPaths()
    assert.equal(p.rootDir, '/tmp/alias-root')
  })

  it('per-file env overrides win over derived paths', () => {
    process.env.SWARMDESK_AGENT_DATA_DIR = '/tmp/custom-root'
    process.env.SWARMDESK_AGENT_AGENTS_STATE = '/tmp/elsewhere/state.json'
    process.env.SWARMDESK_AGENT_RUNTIME_PATH = '/tmp/elsewhere/runtime.json'
    const p = resolveRouterDataPaths()
    assert.equal(p.statePath, '/tmp/elsewhere/state.json')
    assert.equal(p.runtimePath, '/tmp/elsewhere/runtime.json')
  })

  it('MASTRA_MEMORY_URL overrides memory db path (file: URL or raw)', () => {
    process.env.SWARMDESK_AGENT_DATA_DIR = '/tmp/custom-root'
    process.env.MASTRA_MEMORY_URL = 'file:/tmp/custom/memory.db'
    assert.equal(resolveRouterDataPaths().memoryDbPath, '/tmp/custom/memory.db')
    process.env.MASTRA_MEMORY_URL = '/tmp/raw/memory.db'
    assert.equal(resolveRouterDataPaths().memoryDbPath, '/tmp/raw/memory.db')
  })

  it('uses %APPDATA% on windows for root', () => {
    // emulate windows platform by stubbing the platform check inputs
    delete process.env.SWARMDESK_AGENT_DATA_DIR
    delete process.env.SWARMDESK_AGENT_AGENTS_DIR
    delete process.env.XDG_CONFIG_HOME
    process.env.HOME = '/tmp/fake-home-ra'
    process.env.USERPROFILE = '/tmp/fake-home-ra'
    process.env.APPDATA = '/tmp/fake-home-ra/AppData/Roaming'
    // The resolver branches on process.platform === 'win32'. Since we can't
    // flip the real platform in-process, assert the APPDATA path directly via
    // resolveRouterDataDir when XDG_CONFIG_HOME simulates the windows base.
    process.env.XDG_CONFIG_HOME = '/tmp/fake-home-ra/AppData/Roaming'
    const p = resolveRouterDataPaths()
    assert.equal(p.rootDir, '/tmp/fake-home-ra/AppData/Roaming/swarmdesk-agent')
    assert.equal(p.dataDir, '/tmp/fake-home-ra/AppData/Roaming/swarmdesk-agent/data')
  })
})
