#!/usr/bin/env node
/**
 * Explicit, bounded ACP Registry live smoke. This is the only supported entry
 * point for the internal runner and it defaults to refusing third-party code.
 */
import {
  SmokeUsageError,
  createSmokeIsolation,
  parseSmokeArgs,
  runSmokeController,
} from './acp-registry-smoke-control.mjs'

function printUsageError(error) {
  const message = error instanceof SmokeUsageError ? error.message : 'Invalid smoke arguments'
  process.stderr.write(`[smoke:acp-registry] ${message}\n`)
  process.stderr.write(
    'Usage: npm run smoke:acp-registry -- --agents <id[:npx|uvx|binary],...> ' +
      '--confirm-third-party-execution [--timeout-ms 300000] [--json]\n',
  )
}

function printHumanReport(report) {
  process.stdout.write('[smoke:acp-registry] isolated product-path results\n')
  for (const result of report.results) {
    const distribution = result.distribution ? ` (${result.distribution})` : ''
    const next = result.nextAction ? `; next=${result.nextAction}` : ''
    process.stdout.write(
      `- ${result.registryId ?? 'unknown'}${distribution}: ${result.status} [${result.code}]${next}\n`,
    )
  }
}

let options
try {
  options = parseSmokeArgs(process.argv.slice(2))
} catch (error) {
  printUsageError(error)
  process.exitCode = error instanceof SmokeUsageError ? error.exitCode : 2
}

if (options) {
  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  let isolation
  try {
    isolation = createSmokeIsolation()
    const outcome = await runSmokeController({
      options,
      isolation,
      signal: controller.signal,
    })
    if (options.json) {
      process.stdout.write(`${JSON.stringify(outcome.report)}\n`)
    } else {
      printHumanReport(outcome.report)
    }
    process.exitCode = outcome.exitCode
  } catch {
    try {
      isolation?.cleanup()
    } catch {}
    process.stderr.write('[smoke:acp-registry] isolated smoke controller failed\n')
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}
