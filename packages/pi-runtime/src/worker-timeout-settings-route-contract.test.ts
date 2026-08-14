import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

test('HTTP and Desktop settings surfaces transport complete Worker timeout settings', () => {
  const ownerHttp = source('./http-server.ts')
  const desktopMain = source('../../../apps/desktop/electron/main.ts')
  const desktopPreload = source('../../../apps/desktop/electron/preload.ts')
  const rendererSettings = source('../../../apps/desktop/src/lib/settings.ts')
  const rendererApi = source('../../../apps/desktop/src/lib/api.ts')
  const rendererWindow = source('../../../apps/desktop/src/vite-env.d.ts')

  for (const text of [ownerHttp, desktopMain]) {
    assert.match(text, /workerTimeouts\??:\s*WorkerTimeoutSettings/u)
    assert.match(text, /parseWorkerTimeoutSettings/u)
    assert.match(text, /workerTimeouts:/u)
  }
  assert.match(desktopPreload, /workerTimeouts\??:\s*WorkerTimeoutSettings/u)
  assert.match(rendererSettings, /workerTimeouts:\s*WorkerTimeoutSettings/u)
  assert.match(rendererApi, /workerTimeouts:\s*WorkerTimeoutSettings/u)
  assert.match(
    rendererWindow,
    /workerTimeouts\??:\s*import\('@pihuo-agent\/shared'\)\.WorkerTimeoutSettings/u,
  )
  for (const text of [rendererSettings, rendererApi, rendererWindow]) {
    assert.doesNotMatch(text, /@pihuo-agent\/core/u)
  }
})
