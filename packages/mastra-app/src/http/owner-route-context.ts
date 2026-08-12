import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingMessage } from 'node:http'

type DesktopCorsHeaders = (req: IncomingMessage) => Record<string, string>

/**
 * Keeps the Owner API request available to response helpers without threading
 * it through every route handler. The Owner server owns this context; route
 * modules receive only its `corsFor` helper.
 */
export function createOwnerRouteContext(desktopCorsHeaders: DesktopCorsHeaders) {
  const requestAls = new AsyncLocalStorage<IncomingMessage>()

  function currentReq(): IncomingMessage | undefined {
    return requestAls.getStore()
  }

  function corsFor(req?: IncomingMessage): Record<string, string> {
    const request = req ?? currentReq()
    if (request) return desktopCorsHeaders(request)
    return {
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS,PUT,PATCH',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-SwarmDesk-Agent-Desktop-Token, Last-Event-ID',
      Vary: 'Origin',
    }
  }

  return {
    run<T>(req: IncomingMessage, callback: () => T): T {
      return requestAls.run(req, callback)
    },
    corsFor,
  }
}
