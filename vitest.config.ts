import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(process.cwd(), 'src/shared'),
      '@': path.resolve(process.cwd(), 'src/renderer'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/main/core/security.ts',
        'src/main/mod-manager/utils.ts',
        'src/main/mod-manager/manifest.ts',
        'src/shared/**/*.ts',
      ],
    },
  },
})
