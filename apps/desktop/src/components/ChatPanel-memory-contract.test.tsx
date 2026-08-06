import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const panel = readFileSync(new URL('./ChatPanel.tsx', import.meta.url), 'utf8')
const rightPanel = readFileSync(new URL('./RightPanel.tsx', import.meta.url), 'utf8')
const memoryPanel = readFileSync(new URL('./MemoryPanel.tsx', import.meta.url), 'utf8')
const chatCss = readFileSync(new URL('../styles/04-chat.css', import.meta.url), 'utf8')
const inspectorCss = readFileSync(
  new URL('../styles/05-worker-inspector.css', import.meta.url),
  'utf8',
)

describe('Chat project memory header contract', () => {
  it('uses the requested Lucide icons and a dedicated memory inspector tab', () => {
    assert.match(panel, /DatabaseCheck/u)
    assert.match(panel, /DatabaseX/u)
    assert.match(panel, /chat-head-tool-memory/u)
    assert.match(panel, /toggleInspectorTab\('memory'\)/u)
    assert.match(rightPanel, /InspectorTab = 'roles' \| 'approvals' \| 'memory'/u)
    assert.match(rightPanel, /<MemoryPanel/u)
  })

  it('animates icon changes with reduced-motion-aware Framer Motion settings', () => {
    assert.match(panel, /key="memory-on"/u)
    assert.match(panel, /key="memory-off"/u)
    assert.match(panel, /<AnimatePresence initial=\{false\} mode="wait">/u)
    assert.match(panel, /reduceMotion/u)
    assert.match(chatCss, /\.chat-head-tool-memory\.is-memory-on/u)
    assert.match(inspectorCss, /html\[data-motion='reduce'\] \.memory-panel-switch-thumb/u)
  })

  it('keeps memory rendering independent from optional team callbacks', () => {
    assert.match(panel, /inspectorTab === 'memory' \|\|/u)
    assert.match(panel, /onCreateTeamMember=\{onCreateTeamMember \?\? /u)
    assert.match(memoryPanel, /aria-checked=\{enabled\}/u)
    assert.match(panel, /projectMemoryError/u)
  })
})
