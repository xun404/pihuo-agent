const typedFixtureValue: string = 'fixture'

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    results: [
      {
        registryId: typedFixtureValue,
        distribution: 'npx',
        status: 'pass',
        code: 'SESSION_READY',
      },
    ],
  })}\n`,
)
try {
  process.disconnect?.()
} catch {}
