const privateMarker: string = '/Users/alice token=super-secret private-output-marker'

process.stdout.write('x'.repeat(70 * 1024))
process.stderr.write(privateMarker.repeat(2_000))
try {
  process.disconnect?.()
} catch {}
