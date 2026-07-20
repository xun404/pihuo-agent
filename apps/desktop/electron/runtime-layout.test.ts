import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveDesktopRuntimeLayout } from './runtime-layout.js'

describe('desktop runtime layout', () => {
  it('uses source + tsx paths only in development', () => {
    assert.deepEqual(
      resolveDesktopRuntimeLayout({
        isPackaged: false,
        moduleDir: '/repo/apps/desktop/dist-electron',
        resourcesPath: '/unused',
        userDataPath: '/Users/me/Library/Application Support/SwarmDesk',
      }),
      {
        mode: 'development',
        identityRoot: '/repo',
        rendererDist: '/repo/apps/desktop/dist',
        apiEntry: '/repo/packages/mastra-app/src/http-server.ts',
        apiCwd: '/repo/packages/mastra-app',
      },
    )
  })

  it('uses resources/runtime and userData when packaged', () => {
    assert.deepEqual(
      resolveDesktopRuntimeLayout({
        isPackaged: true,
        moduleDir:
          '/Applications/SwarmDesk.app/Contents/Resources/app.asar/apps/desktop/dist-electron',
        resourcesPath: '/Applications/SwarmDesk.app/Contents/Resources',
        userDataPath: '/Users/me/Library/Application Support/SwarmDesk',
      }),
      {
        mode: 'packaged',
        identityRoot: '/Users/me/Library/Application Support/SwarmDesk',
        rendererDist: '/Applications/SwarmDesk.app/Contents/Resources/app.asar/apps/desktop/dist',
        apiEntry: '/Applications/SwarmDesk.app/Contents/Resources/runtime/http-server.mjs',
        apiCwd: '/Applications/SwarmDesk.app/Contents/Resources/runtime',
      },
    )
  })
})
