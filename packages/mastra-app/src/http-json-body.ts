export const DEFAULT_MAX_JSON_BODY_BYTES = 10 * 1024 * 1024
export const MAX_JSON_BODY_BYTES_CAP = 64 * 1024 * 1024

export class HttpJsonBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: 'INVALID_JSON_BODY' | 'REQUEST_BODY_TOO_LARGE',
    message: string,
  ) {
    super(message)
    this.name = 'HttpJsonBodyError'
  }
}

export function resolveMaxJsonBodyBytes(
  raw: string | number | undefined = process.env.SWARMDESK_AGENT_MAX_JSON_BODY_BYTES,
): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_JSON_BODY_BYTES
  return Math.min(Math.floor(parsed), MAX_JSON_BODY_BYTES_CAP)
}

type JsonBodyStream = AsyncIterable<string | Uint8Array> & { resume?: () => void }

export async function readJsonBody(
  stream: JsonBodyStream,
  maxBytes = resolveMaxJsonBodyBytes(),
): Promise<unknown> {
  const limit = resolveMaxJsonBodyBytes(maxBytes)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    total += bytes.length
    if (total > limit) {
      // Let Node discard the remainder without retaining it in JS memory.
      stream.resume?.()
      throw new HttpJsonBodyError(
        413,
        'REQUEST_BODY_TOO_LARGE',
        'Request JSON body exceeds the configured limit',
      )
    }
    chunks.push(bytes)
  }
  const raw = Buffer.concat(chunks, total).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new HttpJsonBodyError(400, 'INVALID_JSON_BODY', 'Request body must be valid JSON')
  }
}
