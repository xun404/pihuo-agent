export type WorkerRole = 'plan' | 'coder' | 'review' | 'test' | 'research' | 'general'

export const PROMPT_ROLE_ORDER = [
  'general',
  'plan',
  'coder',
  'review',
  'test',
  'research',
] as const satisfies readonly WorkerRole[]

export const WORKER_ROLES: WorkerRole[] = ['plan', 'coder', 'review', 'test', 'research', 'general']
