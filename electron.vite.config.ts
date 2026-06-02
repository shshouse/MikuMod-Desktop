import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'electron',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron-src/main.ts'),
        },
        external: [
          'electron',
          'electron-updater',
          'node-forge',
        ],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'electron-src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'electron',
      emptyOutDir: false,
      rollupOptions: {
        output: {
          format: 'cjs',
        },
        input: {
          preload: resolve(__dirname, 'electron-src/preload.ts'),
        },
        external: [
          'electron',
        ],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'electron-src/shared'),
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    root: resolve(__dirname, '.'),
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'electron-src/shared'),
      },
    },
    server: {
      port: 5177,
      strictPort: true,
    },
  },
})
