export function resolveWorkerCwd(
  projectRoot: string | undefined,
  fallback = process.cwd(),
): string {
  return projectRoot && projectRoot.length > 0 ? projectRoot : fallback
}
