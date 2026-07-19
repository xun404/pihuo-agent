import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.ELECTRON === '1'
      ? [
          electron({
            main: {
              entry: path.join(__dirname, 'electron/main.ts'),
              vite: {
                resolve: {
                  alias: {
                    '@swarmdesk-agent/core': path.join(__dirname, '../../packages/core/src/index.ts'),
                    '@swarmdesk-agent/shared': path.join(
                      __dirname,
                      '../../packages/shared/src/index.ts',
                    ),
                  },
                },
                build: {
                  rollupOptions: {
                    external: ['electron'],
                  },
                },
              },
            },
            preload: {
              input: path.join(__dirname, 'electron/preload.ts'),
            },
          }),
        ]
      : []),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
      '@swarmdesk-agent/shared': path.join(__dirname, '../../packages/shared/src/index.ts'),
      '@swarmdesk-agent/core': path.join(__dirname, '../../packages/core/src/index.ts'),
    },
  },
  // Avoid pre-bundling workspace TS packages incorrectly
  optimizeDeps: {
    exclude: ['@swarmdesk-agent/shared', '@swarmdesk-agent/core'],
  },
})
