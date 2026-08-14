import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

export default defineConfig({
  // Relative base so packaged Electron `file://` loads resolve assets next to
  // index.html. Absolute `/…` paths break under file:// (they hit the OS root).
  base: './',
  plugins: [
    react(),
    ...(process.env.ELECTRON === '1'
      ? [
          electron({
            main: {
              entry: path.join(import.meta.dirname, 'electron/main.ts'),
              vite: {
                resolve: {
                  alias: {
                    '@pihuo-agent/core': path.join(
                      import.meta.dirname,
                      '../../packages/core/src/index.ts',
                    ),
                    '@pihuo-agent/shared': path.join(
                      import.meta.dirname,
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
              input: path.join(import.meta.dirname, 'electron/preload.ts'),
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
      '@': path.join(import.meta.dirname, 'src'),
      '@pihuo-agent/shared': path.join(
        import.meta.dirname,
        '../../packages/shared/src/index.ts',
      ),
      '@pihuo-agent/core': path.join(import.meta.dirname, '../../packages/core/src/index.ts'),
    },
  },
  // Avoid pre-bundling workspace TS packages incorrectly
  optimizeDeps: {
    exclude: ['@pihuo-agent/shared', '@pihuo-agent/core'],
  },
})
