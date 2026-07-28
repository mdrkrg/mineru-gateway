import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.ts'],
    },
  },
  resolve: {
    conditions: ['browser', 'module', 'import', 'default'],
  },
});
