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
                    '@router-agents/core': path.join(
                      __dirname,
                      '../../packages/core/src/index.ts',
                    ),
                    '@router-agents/shared': path.join(
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
      '@router-agents/shared': path.join(__dirname, '../../packages/shared/src/index.ts'),
      '@router-agents/core': path.join(__dirname, '../../packages/core/src/index.ts'),
    },
  },
  // Avoid pre-bundling workspace TS packages incorrectly
  optimizeDeps: {
    exclude: ['@router-agents/shared', '@router-agents/core'],
  },
})

