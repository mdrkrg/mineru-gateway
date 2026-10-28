import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    localStorage.setItem('auth_access_token', 'browser-test-access');
    localStorage.setItem('auth_refresh_token', 'browser-test-refresh');
    localStorage.setItem('gateway_active_api_key', 'browser-test-key');
    localStorage.setItem('gateway_locale', 'en');
  });
  // Exercise the real SPA and HTTP client, but keep every API call local.
  await page.route(`${baseURL}/api/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/users/me') {
      await route.fulfill({
        json: {
          id: 'browser-test-user',
          email: 'browser@example.com',
          is_active: true,
          is_verified: true,
          is_superuser: false,
          display_name: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      });
    } else if (path === '/api/v1/tasks' && route.request().method() === 'GET') {
      await route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 50 } });
    } else {
      await route.abort();
    }
  });
});

test('parse selects show their defaults and retain selections across locale changes', async ({ page }) => {
  await page.goto('/upload');
  const tier = page.getByRole('combobox', { name: /Quality Tier|解析档位/ });
  const ocr = page.getByRole('combobox', { name: /OCR Mode|OCR 模式/ });
  const language = page.getByRole('combobox', { name: /Language|语言/ });

  await expect(tier).toHaveValue('standard');
  await expect(ocr).toHaveValue('auto');
  await tier.selectOption('advanced');
  await ocr.selectOption('ocr');

  await language.selectOption('zh-CN');
  await expect(tier).toHaveValue('advanced');
  await expect(ocr).toHaveValue('ocr');
  await language.selectOption('en');
  await expect(tier).toHaveValue('advanced');
  await expect(ocr).toHaveValue('ocr');
});

test('status filtering keeps its selection across locale changes and can return to all', async ({ page }) => {
  await page.goto('/tasks');
  const status = page.getByRole('combobox', { name: /Status|状态/ });
  const language = page.getByRole('combobox', { name: /Language|语言/ });

  await expect(status).toHaveValue('');
  await status.selectOption('completed');
  await language.selectOption('zh-CN');
  await expect(status).toHaveValue('completed');

  const filtered = page.waitForRequest('**/api/v1/tasks?**');
  await page.locator('form button[type="submit"]').click();
  expect(new URL((await filtered).url()).searchParams.get('status')).toBe('completed');

  await status.selectOption('');
  await language.selectOption('en');
  await expect(status).toHaveValue('');
  const unfiltered = page.waitForRequest('**/api/v1/tasks?**');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  expect(new URL((await unfiltered).url()).searchParams.has('status')).toBe(false);
});
