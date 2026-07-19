import { SimpleAuth } from '@mastra/core/server'

export const STUDIO_LOOPBACK_HOST = '127.0.0.1'
export const DEFAULT_STUDIO_PORT = 4112

export interface RouterStudioUser {
  id: string
  name: string
  role: 'admin'
}

function requireStrongStudioToken(token: string): string {
  const normalized = token.trim()
  if (normalized.length < 16) {
    throw new Error('Studio token must contain at least 16 characters')
  }
  return normalized
}

/**
 * Mastra-native auth keeps Studio UI and its API routes on one security model.
 * This token is deliberately separate from owner-runtime and Desktop capabilities.
 */
export function createStudioAuth(token: string): SimpleAuth<RouterStudioUser> {
  const normalized = requireStrongStudioToken(token)
  return new SimpleAuth<RouterStudioUser>({
    tokens: {
      [normalized]: {
        id: 'router-agents-studio',
        name: 'Router Agents Studio',
        role: 'admin',
      },
    },
  })
}

export function resolveStudioPort(explicitPort: string | undefined, ownerPort: number): number {
  const defaultPort =
    ownerPort === DEFAULT_STUDIO_PORT ? DEFAULT_STUDIO_PORT + 1 : DEFAULT_STUDIO_PORT
  const port = explicitPort?.trim() ? Number(explicitPort) : defaultPort
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('ROUTER_STUDIO_PORT must be a valid TCP port')
  }
  if (port === ownerPort) {
    throw new Error('ROUTER_STUDIO_PORT must differ from the owner API port')
  }
  return port
}

export function buildStudioAuthUrl(input: { port: number; token: string }): string {
  const token = requireStrongStudioToken(input.token)
  const url = new URL(`http://${STUDIO_LOOPBACK_HOST}:${input.port}/`)
  // Mastra consumes this once, retains it in memory, then removes it from the address bar.
  url.searchParams.set('auth_header', `Bearer ${token}`)
  return url.toString()
}
