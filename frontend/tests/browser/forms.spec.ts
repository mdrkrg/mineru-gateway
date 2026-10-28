import { expect, test, type Page } from '@playwright/test';

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
    } else if (path === '/api/v1/tasks' && route.request().method() === 'POST') {
      // Keep the form available so a user can retry the same payload.
      await route.fulfill({ status: 503, json: { detail: 'upstream unavailable' } });
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

async function submitUpload(page: Page) {
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/tasks'),
  );
  const button = page.locator('form button[type="submit"]');
  await button.click();
  const request = await sent;
  await expect(button).toBeEnabled();
  const form = await new Response(request.postData(), {
    headers: { 'Content-Type': request.headers()['content-type'] },
  }).formData();
  return { form, idempotencyKey: request.headers()['x-idempotency-key'] };
}

test.describe('upload artifacts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/upload');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\n%%EOF'),
    });
  });

  test('submits only checked artifacts and keeps parse options after locale changes', async ({ page }) => {
    const markdown = page.getByRole('checkbox', { name: 'Markdown', exact: true });
    const zip = page.getByRole('checkbox', { name: 'ZIP archive', exact: true });
    const middle = page.getByRole('checkbox', { name: 'Middle JSON', exact: true });
    const structured = page.getByRole('checkbox', { name: 'Structured Content', exact: true });

    await expect(markdown).toBeChecked();
    await expect(zip).toBeChecked();
    await expect(middle).not.toBeChecked();
    await expect(structured).not.toBeChecked();
    await markdown.uncheck();
    await zip.uncheck();
    // Click in reverse display order; the submitted selection stays canonical.
    await structured.check();
    await middle.check();
    await page.getByRole('combobox', { name: 'Quality Tier' }).selectOption('advanced');
    await page.getByRole('combobox', { name: 'OCR Mode' }).selectOption('ocr');
    const language = page.getByRole('combobox', { name: /Language|语言/ });
    await language.selectOption('zh-CN');
    await language.selectOption('en');

    await expect(markdown).not.toBeChecked();
    await expect(zip).not.toBeChecked();
    await expect(middle).toBeChecked();
    await expect(structured).toBeChecked();
    const { form } = await submitUpload(page);
    expect(form.getAll('output_formats')).toEqual(['middle_json,structured_content']);
    expect(form.get('tier')).toBe('advanced');
    expect(form.get('ocr_mode')).toBe('ocr');
  });

  test('blocks an empty artifact selection before sending and allows correction', async ({ page }) => {
    let submissions = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/v1/tasks')) {
        submissions += 1;
      }
    });
    await page.getByRole('checkbox', { name: 'Markdown', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'ZIP archive', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Submit task (1 files)', exact: true }).click();

    await expect(
      page.getByText('Choose at least one artifact format to return', { exact: true }),
    ).toBeVisible();
    expect(submissions).toBe(0);

    await page.getByRole('checkbox', { name: 'Markdown', exact: true }).check();
    const { form } = await submitUpload(page);
    expect(form.getAll('output_formats')).toEqual(['markdown']);
    expect(submissions).toBe(1);
  });

  test('reuses the idempotency key for retries but replaces it when artifacts change', async ({ page }) => {
    const first = await submitUpload(page);
    expect(first.idempotencyKey).toBeTruthy();
    expect(first.form.get('output_formats')).toBe('markdown,zip');
    const retry = await submitUpload(page);
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.form.get('output_formats')).toBe('markdown,zip');

    await page.getByRole('checkbox', { name: 'ZIP archive', exact: true }).uncheck();
    const changed = await submitUpload(page);
    expect(changed.idempotencyKey).toBeTruthy();
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(changed.form.get('output_formats')).toBe('markdown');
    const changedRetry = await submitUpload(page);
    expect(changedRetry.idempotencyKey).toBe(changed.idempotencyKey);
  });
});
