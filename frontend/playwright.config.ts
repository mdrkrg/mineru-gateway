import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build && pnpm serve --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    // Do not inherit deployment settings or contact a configured gateway.
    env: {
      VITE_APP_BASE_PATH: '/',
      VITE_API_PREFIX: '/api',
      VITE_API_BASE: 'http://127.0.0.1:1',
      VITE_MAX_UPLOAD_SIZE: '524288000',
      VITE_MAX_FILE_SIZE: '209715200',
    },
  },
});
