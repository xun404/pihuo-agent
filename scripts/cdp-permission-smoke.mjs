#!/usr/bin/env node
/**
 * Repeatable Chat Session permission smoke for a running Electron dev app.
 *
 * The script intentionally does not create a project, choose a worker, or
 * resolve arbitrary existing approvals.  Start it with an already active
 * Claude Agent Chat Session and provide both Write prompts explicitly:
 *
 *   node scripts/cdp-permission-smoke.mjs \
 *     --first-prompt "Use Claude Write to create ..." \
 *     --second-prompt "Use Claude Write to replace ..."
 *
 * It exercises: Write -> pending -> Chat Session shield on (auto allow) ->
 * shield off -> another Write pending -> cancel.  Home's draft shield is
 * never selected.  The script uses scripts/cdp-check.mjs for the CDP wire
 * protocol, so it has the same CDP_HOST/CDP_PORT behavior as the other
 * development helpers and requires no extra dependency.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const checkerPath = join(dirname(fileURLToPath(import.meta.url)), 'cdp-check.mjs')

function usage() {
  console.error(`Usage:
  node scripts/cdp-permission-smoke.mjs \\
    --first-prompt "Use Claude Write to create ..." \\
    --second-prompt "Use Claude Write to replace ..."

Options:
  --timeout-ms <n>       Per-state automation polling budget, not an approval timeout (default: 120000)
  --poll-ms <n>          Poll interval (default: 1000)
  --worker-pattern <re>  Expected worker name pattern (default: claude)
  --help                 Show this help

Preconditions:
  * npm run desktop is running with CDP enabled;
  * the visible active Chat Session is configured for Claude Agent;
  * the Session is in default mode and has no pending approvals;
  * both prompts explicitly ask the Agent to use its Write tool in a safe
    temporary path.`)
}

function parseArgs(argv) {
  const out = {
    firstPrompt: '',
    secondPrompt: '',
    timeoutMs: 120_000,
    pollMs: 1_000,
    workerPattern: 'claude',
  }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help') {
      usage()
      process.exit(0)
    }
    const value = argv[i + 1]
    if (arg === '--first-prompt') out.firstPrompt = value ?? ''
    else if (arg === '--second-prompt') out.secondPrompt = value ?? ''
    else if (arg === '--timeout-ms') out.timeoutMs = Number(value)
    else if (arg === '--poll-ms') out.pollMs = Number(value)
    else if (arg === '--worker-pattern') out.workerPattern = value ?? ''
    else throw new Error(`Unknown argument: ${arg}`)
    if (arg !== '--help') i += 1
  }
  if (!out.firstPrompt.trim() || !out.secondPrompt.trim()) {
    usage()
    throw new Error('--first-prompt and --second-prompt are required')
  }
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs < 1_000) {
    throw new Error('--timeout-ms must be at least 1000')
  }
  if (!Number.isFinite(out.pollMs) || out.pollMs < 100) {
    throw new Error('--poll-ms must be at least 100')
  }
  if (!out.workerPattern) throw new Error('--worker-pattern cannot be empty')
  try {
    new RegExp(out.workerPattern)
  } catch (error) {
    throw new Error(`--worker-pattern must be a valid regular expression: ${error}`)
  }
  return out
}

const options = parseArgs(process.argv)

async function evalInRenderer(expression) {
  let stdout = ''
  let stderr = ''
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, [checkerPath, 'eval', expression], {
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    }))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`CDP eval failed: ${detail}${stderr ? `\n${stderr.trim()}` : ''}`)
  }
  const text = stdout.trim()
  if (!text) throw new Error(`CDP eval returned no value${stderr ? `\n${stderr.trim()}` : ''}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`CDP eval returned non-JSON output: ${text.slice(0, 500)}`)
  }
}

const snapshotExpression = `
  (async () => {
    const token = await window.routerAgents?.getDesktopToken?.();
    const base = window.routerAgents?.apiBase || 'http://127.0.0.1:4111';
    if (!token) throw new Error('desktop token unavailable');
    const response = await fetch(base + '/api/snapshot', {
      headers: {
        Authorization: 'Bearer ' + token,
        'X-SwarmDesk-Agent-Desktop-Token': token,
      },
    });
    const body = await response.json();
    if (!response.ok) throw new Error('snapshot HTTP ' + response.status);
    return body;
  })()
`

const activeChatContractExpression = `
  (() => {
    const panes = [...document.querySelectorAll('.chat-workspace-pane.active')]
      .filter((pane) => pane.getAttribute('aria-hidden') !== 'true');
    const buttons = panes
      .flatMap((pane) => [...pane.querySelectorAll('.permission-mode-action')])
      .filter((button) => !button.closest('.home-composer'));
    const pane = panes.find((candidate) =>
      candidate.querySelector('.composer-card:not(.home-composer) textarea.composer-input'));
    return {
      paneCount: panes.length,
      chatShieldCount: buttons.length,
      homeShieldCount: document.querySelectorAll('.home-composer .permission-mode-action').length,
      shieldPressed: buttons[0]?.getAttribute('aria-pressed') ?? null,
      hasComposer: !!pane,
      hasSendButton: !!pane?.querySelector('.composer-card:not(.home-composer) button.send:not(.stop)'),
    };
  })()
`

const clickChatShieldExpression = `
  (() => {
    const panes = [...document.querySelectorAll('.chat-workspace-pane.active')]
      .filter((pane) => pane.getAttribute('aria-hidden') !== 'true');
    const buttons = panes
      .flatMap((pane) => [...pane.querySelectorAll('.permission-mode-action')])
      .filter((button) => !button.closest('.home-composer'));
    if (buttons.length !== 1) {
      return { clicked: false, reason: 'expected exactly one active Chat Session shield', count: buttons.length };
    }
    const button = buttons[0];
    if (button.disabled) return { clicked: false, reason: 'Chat Session shield is busy' };
    const before = button.getAttribute('aria-pressed');
    button.click();
    return { clicked: true, before, after: button.getAttribute('aria-pressed') };
  })()
`

function sendPromptExpression(prompt) {
  return `
    (() => {
      const panes = [...document.querySelectorAll('.chat-workspace-pane.active')]
        .filter((pane) => pane.getAttribute('aria-hidden') !== 'true');
      const pane = panes.find((candidate) =>
        candidate.querySelector('.composer-card:not(.home-composer) textarea.composer-input'));
      const textarea = pane?.querySelector('.composer-card:not(.home-composer) textarea.composer-input');
      const button = pane?.querySelector('.composer-card:not(.home-composer) button.send:not(.stop)');
      if (!pane || !textarea || !button) {
        return { sent: false, reason: 'active Chat Session composer is not ready' };
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return { sent: false, reason: 'textarea native setter unavailable' };
      setter.call(textarea, ${JSON.stringify(prompt)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      if (button.disabled) return { sent: false, reason: 'send button stayed disabled' };
      button.click();
      return { sent: true, value: textarea.value };
    })()
  `
}

function cancelApprovalExpression(approvalId) {
  return `
    (async () => {
      const token = await window.routerAgents?.getDesktopToken?.();
      const base = window.routerAgents?.apiBase || 'http://127.0.0.1:4111';
      if (!token) throw new Error('desktop token unavailable');
      const response = await fetch(base + '/api/approvals/' + encodeURIComponent(${JSON.stringify(approvalId)}) + '/resolve', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'X-SwarmDesk-Agent-Desktop-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'cancel', surface: 'chat' }),
      });
      const body = await response.json();
      return { status: response.status, body };
    })()
  `
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(label, probe) {
  const deadline = Date.now() + options.timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      const result = await probe()
      last = result
      if (result?.ok) return result
    } catch (error) {
      last = { error: error instanceof Error ? error.message : String(error) }
    }
    await sleep(options.pollMs)
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)?.slice(0, 1200)}`)
}

function sessionFor(snapshot, sessionId) {
  return (snapshot.sessions ?? []).find((session) => session.id === sessionId) ?? null
}

function pendingFor(snapshot, sessionId, baselineApprovalIds) {
  return (snapshot.approvals ?? [])
    .filter(
      (approval) =>
        approval.status === 'pending' &&
        approval.sessionId === sessionId &&
        !baselineApprovalIds.has(approval.id),
    )
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0]
}

function isExpectedWorker(approval, snapshot, pattern) {
  const job = (snapshot.jobs ?? []).find((candidate) => candidate.id === approval?.jobId)
  const workerText = `${approval?.workerName ?? ''} ${job?.workerName ?? ''}`
  return new RegExp(pattern, 'i').test(workerText)
}

async function clickChatShield() {
  const result = await waitFor('active Chat Session shield to be clickable', async () => {
    const value = await evalInRenderer(clickChatShieldExpression)
    return { ...value, ok: value?.clicked === true }
  })
  console.log(`shield click: ${JSON.stringify(result)}`)
}

async function waitComposerReady() {
  return waitFor('active Chat Session composer', async () => {
    const value = await evalInRenderer(activeChatContractExpression)
    return { ...value, ok: value?.hasComposer === true && value?.hasSendButton === true }
  })
}

async function sendPrompt(prompt, label) {
  await waitComposerReady()
  const result = await waitFor(`${label} prompt to submit`, async () => {
    const value = await evalInRenderer(sendPromptExpression(prompt))
    return { ...value, ok: value?.sent === true }
  })
  console.log(`${label} submitted: ${JSON.stringify(result)}`)
}

async function waitForNewPending(sessionId, baselineApprovalIds, label) {
  const result = await waitFor(`${label} approval`, async () => {
    const snapshot = await evalInRenderer(snapshotExpression)
    const approval = pendingFor(snapshot, sessionId, baselineApprovalIds)
    return { ok: !!approval, approval, snapshot }
  })
  const approval = result.approval
  // Register the newly observed item before validating its worker so a
  // mismatched fixture is still cancelled by the fail-closed cleanup.
  createdApprovalIds.push(approval.id)
  if (!isExpectedWorker(approval, result.snapshot, options.workerPattern)) {
    throw new Error(
      `${label} approval came from an unexpected worker: ${JSON.stringify({
        workerName: approval.workerName,
        jobId: approval.jobId,
      })}`,
    )
  }
  console.log(`${label} pending: ${JSON.stringify({ id: approval.id, action: approval.action, workerName: approval.workerName })}`)
  return approval
}

const createdApprovalIds = []
let activeSessionId = null
let restoreDefaultShield = false

async function bestEffortCleanup() {
  if (restoreDefaultShield) {
    try {
      const contract = await evalInRenderer(activeChatContractExpression)
      if (contract?.shieldPressed === 'true') await evalInRenderer(clickChatShieldExpression)
    } catch {
      // The primary error is more useful than cleanup diagnostics.
    }
  }
  for (const approvalId of createdApprovalIds) {
    try {
      const snapshot = await evalInRenderer(snapshotExpression)
      const approval = (snapshot.approvals ?? []).find((item) => item.id === approvalId)
      if (approval?.status === 'pending') await evalInRenderer(cancelApprovalExpression(approvalId))
    } catch {
      // Do not mask the original failure.
    }
  }
}

try {
  const initialSnapshot = await evalInRenderer(snapshotExpression)
  activeSessionId = initialSnapshot.activeSessionId
  if (!activeSessionId) throw new Error('no active Session in API snapshot')
  const session = sessionFor(initialSnapshot, activeSessionId)
  if (!session) throw new Error(`active Session ${activeSessionId} is missing from snapshot`)
  if (session.permissionMode !== 'default') {
    throw new Error(`active Session must start in default mode (got ${session.permissionMode})`)
  }
  const existingPending = (initialSnapshot.approvals ?? []).filter(
    (approval) => approval.status === 'pending' && approval.sessionId === activeSessionId,
  )
  if (existingPending.length > 0) {
    throw new Error(`active Session already has pending approvals: ${existingPending.map((item) => item.id).join(', ')}`)
  }
  const contract = await evalInRenderer(activeChatContractExpression)
  if (contract?.paneCount !== 1 || contract?.chatShieldCount !== 1 || !contract?.hasComposer) {
    throw new Error(`active Chat Session contract failed: ${JSON.stringify(contract)}`)
  }
  console.log(`active Session ${activeSessionId}; Chat shield scoped correctly (Home shields: ${contract.homeShieldCount})`)

  const baselineFirst = new Set((initialSnapshot.approvals ?? []).map((approval) => approval.id))
  await sendPrompt(options.firstPrompt, 'first Write')
  const firstApproval = await waitForNewPending(activeSessionId, baselineFirst, 'first Write')

  await clickChatShield()
  restoreDefaultShield = true
  const firstAllowed = await waitFor('first approval to be auto-allowed', async () => {
    const snapshot = await evalInRenderer(snapshotExpression)
    const approval = (snapshot.approvals ?? []).find((item) => item.id === firstApproval.id)
    const currentSession = sessionFor(snapshot, activeSessionId)
    return {
      ok: currentSession?.permissionMode === 'auto' && approval?.status === 'allowed',
      sessionMode: currentSession?.permissionMode,
      approval,
    }
  })
  if (firstAllowed.approval?.selectedOption?.kind !== 'allow_once') {
    throw new Error(`first approval did not use allow_once: ${JSON.stringify(firstAllowed.approval)}`)
  }
  console.log(`first approval allowed with ${firstAllowed.approval.selectedOption.kind}`)

  await clickChatShield()
  await waitFor('Session shield to return to default', async () => {
    const snapshot = await evalInRenderer(snapshotExpression)
    return { ok: sessionFor(snapshot, activeSessionId)?.permissionMode === 'default' }
  })
  restoreDefaultShield = false

  const afterFirst = await evalInRenderer(snapshotExpression)
  const baselineSecond = new Set((afterFirst.approvals ?? []).map((approval) => approval.id))
  await sendPrompt(options.secondPrompt, 'second Write')
  const secondApproval = await waitForNewPending(activeSessionId, baselineSecond, 'second Write')

  const cancelled = await evalInRenderer(cancelApprovalExpression(secondApproval.id))
  if (cancelled?.status !== 200 || cancelled?.body?.approval?.status !== 'cancelled') {
    throw new Error(`cancel did not resolve the second approval: ${JSON.stringify(cancelled)}`)
  }
  console.log(`second approval cancelled without optionId: ${secondApproval.id}`)
  console.log('PASS: Claude Write -> pending -> shield on/allow_once -> shield off -> pending -> cancel')
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await bestEffortCleanup()
}
