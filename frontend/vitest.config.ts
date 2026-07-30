import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import solidPlugin from 'vite-plugin-solid';

const testMode = process.env.TEST_ENV || 'core';
const isE2E = testMode === 'e2e';
const isAll = testMode === 'all';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'node',
    include: isE2E ? ['tests/e2e/**/*.test.ts'] : ['tests/**/*.test.ts'],
    exclude: isE2E || isAll ? [] : ['tests/e2e/**'],
    ...(isE2E || isAll ? {
      globalSetup: ['./tests/e2e/globalSetup.ts'],
      testTimeout: 15_000,
      fileParallelism: false,
    } : {}),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/routeTree.gen.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    conditions: isE2E || isAll
      ? ['browser', 'module', 'import', 'default']
      : ['node'],
  },
});
