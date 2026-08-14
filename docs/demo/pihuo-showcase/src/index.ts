import { listOpenTasks, type Task } from './tasks.ts'

/** Tiny demo entry — gives the file tree something real to show. */
export function summarizeBoard(tasks: Task[] = listOpenTasks()): string {
  const open = tasks.filter((t) => t.status !== 'done')
  return `${open.length} open · ${tasks.length} total`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(summarizeBoard())
}
