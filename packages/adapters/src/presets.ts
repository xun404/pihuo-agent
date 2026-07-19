import type { WorkerKind, WorkerRegistration } from '@router-agents/shared'

/** Built-in ACP worker presets (command may need local install). */
export const WORKER_PRESETS: Record<
  Exclude<WorkerKind, 'custom'>,
  Pick<
    WorkerRegistration,
    'name' | 'kind' | 'command' | 'args' | 'primaryRole' | 'roles' | 'capabilities' | 'description'
  >
> = {
  claude: {
    name: 'Claude Code',
    kind: 'claude',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp@latest'],
    primaryRole: 'coder',
    roles: ['coder', 'plan', 'research', 'general'],
    capabilities: ['code-edit', 'plan', 'research', 'general'],
    description:
      'Primary coder: multi-file implementation and refactors via ACP. Can also plan and research.',
  },
  codex: {
    name: 'Codex CLI',
    kind: 'codex',
    command: 'npx',
    args: ['-y', '@zed-industries/codex-acp@latest'],
    primaryRole: 'review',
    roles: ['review', 'coder', 'test', 'general'],
    capabilities: ['review', 'code-edit', 'test', 'general'],
    description:
      'Primary reviewer: code review and quality checks via ACP. Also capable of coding and tests.',
  },
  opencode: {
    name: 'OpenCode',
    kind: 'opencode',
    command: 'opencode',
    args: ['acp'],
    primaryRole: 'general',
    roles: ['general', 'coder', 'plan', 'test'],
    capabilities: ['general', 'code-edit', 'plan', 'test'],
    description:
      'General-purpose coding agent via native ACP. Flexible for plan / code / test tasks.',
  },
}

export function resolveWorkerCwd(
  projectRoot: string | undefined,
  fallback = process.cwd(),
): string {
  return projectRoot && projectRoot.length > 0 ? projectRoot : fallback
}
