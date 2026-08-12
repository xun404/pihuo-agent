import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const tokens = read('../styles/00-tokens.css')
const chatEntry = read('../styles/04-chat.css')
const chat = [
  '../styles/chat/00-header.css',
  '../styles/chat/01-messages-markdown.css',
  '../styles/chat/02-process-worker.css',
  '../styles/chat/03-approvals-errors-navigation.css',
]
  .map(read)
  .join('\n')
const composer = read('../styles/03-composer.css')
const inspector = read('../styles/05-worker-inspector.css')
const shell = read('../styles/08-product-shell.css')

test('keeps text smoothing in the shared token layer', () => {
  assert.match(tokens, /-webkit-font-smoothing:\s*antialiased/u)
  assert.match(tokens, /button,\s*input,\s*textarea,\s*select\s*\{/u)
  assert.doesNotMatch(shell, /-webkit-font-smoothing/u)
})

test('chat prose and process typography use semantic variables', () => {
  assert.match(chatEntry, /@import '\.\/chat\/index\.css';/u)
  assert.match(chat, /font-size:\s*var\(--chat-body-size\)/u)
  assert.match(chat, /font-family:\s*var\(--font-prose/u)
  assert.match(chat, /font-size:\s*var\(--chat-process-size\)/u)
  assert.doesNotMatch(chat, /font-size:\s*12\.5px/u)
  assert.doesNotMatch(chat, /line-height:\s*1\.65/u)
})

test('chat source color namespaces are consumed and composer bypasses are removed', () => {
  assert.match(chat, /var\(--chat-user-message-background/u)
  assert.match(chat, /var\(--markdown-inline-code-background/u)
  assert.match(chat, /var\(--tools-background/u)
  assert.match(composer, /var\(\s*--tools-edit-added-background/u)
  assert.match(composer, /var\(--tools-border/u)
  assert.doesNotMatch(composer, /font-weight:\s*(?:500|600);/u)
})

test('markdown bold uses the theme token and thinking blocks de-bold', () => {
  assert.match(chat, /\.msg\.leader \.md-content strong\s*\{[\s\S]*?var\(--markdown-bold/u)
  assert.match(
    chat,
    /\.thinking-block-body strong,[\s\S]*\.thinking-block-body b\s*\{[\s\S]*font-weight:\s*inherit/u,
  )
})

test('worker Markdown emphasis inherits the process gray instead of prose black', () => {
  assert.match(
    chat,
    /\.msg\.leader \.worker-action-markdown \.md-content strong,\s*\.msg\.leader \.worker-action-markdown \.md-content b\s*\{[\s\S]*?color:\s*inherit;/u,
  )
})

test('completed process summaries keep the divider without striking the label', () => {
  const labelBlock = chat.match(/\.worked-for-label\s*\{[\s\S]*?\}/u)?.[0] ?? ''
  assert.doesNotMatch(labelBlock, /text-decoration:\s*line-through/u)
  assert.match(chat, /\.worked-for-rule\s*\{[\s\S]*border-top:\s*1px/u)
})

test('markdown horizontal rules use the themed chat divider', () => {
  assert.match(
    chat,
    /\.sup-text hr,[\s\S]*?\.sup-text\.md-content hr\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-top:\s*1px solid var\(--chat-divider/u,
  )
})

test('source heading keys normalize to kebab-case with digit boundary', () => {
  assert.match(chat, /var\(--markdown-heading-1/u)
})

test('worker inspector role colors use theme tokens', () => {
  assert.match(inspector, /\.team-role-tag\.tone-plan[\s\S]*var\(--purple\)/u)
  assert.match(inspector, /\.team-role-tag\.tone-research[\s\S]*var\(--diff-syn-type/u)
  assert.doesNotMatch(inspector, /color:\s*#8a7a9a/u)
  assert.doesNotMatch(inspector, /color:\s*#6a8a9a/u)
})
