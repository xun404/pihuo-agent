import React from 'react'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n/I18nProvider.js'
import type { ProjectMemorySnapshot } from '../lib/api.js'
import { MemoryPanel } from './MemoryPanel.js'

const memory: ProjectMemorySnapshot = {
  projectId: 'project-memory-test',
  enabled: true,
  content: '# API contract\n\nKeep **the API** stable.',
  lastMessages: 12,
  workingMemory: true,
  semanticRecall: false,
  observationalMemory: false,
  storage: '/private/ignored/memory.db',
  docs: 'https://mastra.ai/docs/memory/overview',
}

function render(enabled: boolean, loading = false) {
  return renderToStaticMarkup(
    <I18nProvider serverLocale="zh">
      <MemoryPanel
        projectName="Memory test project"
        enabled={enabled}
        memory={memory}
        loading={loading}
        saving={false}
        error={null}
        onToggle={() => {}}
        onSave={() => {}}
      />
    </I18nProvider>,
  )
}

describe('MemoryPanel', () => {
  it('exposes the switch, working-memory editor, save action, and status rows', () => {
    const html = render(true)
    assert.match(html, /role="switch"/u)
    assert.match(html, /aria-checked="true"/u)
    assert.doesNotMatch(html, /id="project-memory-content"/u)
    assert.match(html, /memory-panel-markdown/u)
    assert.match(html, /<h1>API contract<\/h1>/u)
    assert.match(html, /<strong>the API<\/strong>/u)
    assert.match(html, /settings-link-inline memory-panel-edit-link/u)
    assert.match(html, /编辑/u)
    assert.match(html, /Semantic recall/u)
  })

  it('exposes the disabled state and prevents editing while loading', () => {
    const html = render(false, true)
    assert.match(html, /aria-checked="false"/u)
    assert.match(html, /disabled=""/gu)
    assert.match(html, /加载中/u)
  })
})
