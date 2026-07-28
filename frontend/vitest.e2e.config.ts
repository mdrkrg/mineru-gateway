import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    globalSetup: ['./tests/e2e/globalSetup.ts'],
    testTimeout: 15_000,
    fileParallelism: false,
  },
  resolve: {
    conditions: ['browser', 'module', 'import', 'default'],
  },
});
