import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const dir = dirname(fileURLToPath(import.meta.url))
const workspaceSource = readFileSync(join(dir, 'ChatWorkspace.tsx'), 'utf8')
const settingsSource = readFileSync(join(dir, 'SettingsPanel.tsx'), 'utf8')
const toolbarSource = readFileSync(join(dir, 'ComposerToolbar.tsx'), 'utf8')
const panelSource = readFileSync(join(dir, 'ChatPanel.tsx'), 'utf8')

describe('ChatWorkspace home model presets', () => {
  it('reloads leader models when settings closes or default model changes', () => {
    assert.match(workspaceSource, /SETTINGS_CLOSED_EVENT/)
    assert.match(workspaceSource, /LEADER_MODEL_CHANGED_EVENT/)
    assert.match(workspaceSource, /loadPresetModels/)
    assert.match(workspaceSource, /addEventListener\(SETTINGS_CLOSED_EVENT/)
    assert.match(workspaceSource, /addEventListener\(LEADER_MODEL_CHANGED_EVENT/)
  })

  it('follows a changed leaderModel on Home while keeping one-off picks only until then', () => {
    assert.match(workspaceSource, /leaderChanged && current/)
    assert.match(workspaceSource, /Home tracks the app default model/)
  })
})

describe('Settings default model persistence', () => {
  it('persists pickModel via saveSettings and does not clobber default when browsing providers', () => {
    assert.match(settingsSource, /const pickModel = \(id: string\) => \{[\s\S]*saveSettings\(\{\s*leaderModel: id/)
    assert.match(settingsSource, /dispatchLeaderModelChanged/)
    assert.match(
      settingsSource,
      /Browsing a provider must NOT change the persisted default model/,
    )
    assert.doesNotMatch(
      settingsSource,
      /const pickProvider = \(p: SettingsProvider\) => \{[\s\S]*setLeaderModel\(next\)/,
    )
  })
})

describe('Composer model menu stay-open', () => {
  it('does not close the cascade after model or thinking selection', () => {
    assert.match(toolbarSource, /Leave the cascade open/)
    assert.match(toolbarSource, /Keep the model\/thinking cascade open/)
    // Model pick no longer closes menus (only outside-click / Esc should).
    const modelPick = toolbarSource.match(
      /onClick=\{\(\) => \{\s*onModelChange\(m\.id\)[\s\S]*?\}\s*\}/,
    )
    assert.ok(modelPick, 'model pick handler present')
    assert.doesNotMatch(modelPick[0], /setModelMenuOpen\(false\)/)
    assert.doesNotMatch(modelPick[0], /setModelSideOpen\(false\)/)
  })
})

describe('ChatPanel session model stickiness', () => {
  it('keeps a previous session model when reloading after default changes', () => {
    assert.match(panelSource, /Existing session selection is sticky/)
    assert.match(
      panelSource,
      /previous && list\.some\(\(m\) => m\.id === previous\)\s*\?\s*previous/,
    )
  })
})
