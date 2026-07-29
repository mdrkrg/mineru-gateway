/**
 * E2E tests for task management and proxy endpoints.
 *
 * Verifies the task lifecycle against a running gateway + mock upstream:
 *   POST   /tasks           submit (async, multipart)
 *   POST   /file_parse       synchronous file parse
 *   GET    /tasks            list with filters
 *   GET    /tasks/stats      task statistics
 *   GET    /tasks/{id}       task detail
 *   DELETE /tasks/{id}       cancel a task
 *   POST   /tasks/cancel     batch cancel
 *
 * The gateway runs with GATEWAY_ENABLE_BACKGROUND=false so submitted tasks
 * stay in "pending" status.  Result download and result-zip tests are
 * deferred because they require completed tasks from background status sync.
 *
 * Each describe block that mutates mock state calls mock.reset() upfront
 * to handle state from previous test files.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setApiBaseUrl } from '../../src/core';
import { isHttpError } from '../../src/core';
import {
  submitTask,
  parseFile,
  listTasks,
  getTaskStats,
  getTaskDetail,
  cancelTask,
  batchCancelTasks,
} from '../../src/api';
import { MockControl } from './mock-control';
import { loadE2EUrls, samplePdfFormData } from './helpers';
import { createApiKey } from '../../src/api';

let apiKey: string;
let mock: MockControl;

beforeAll(async () => {
  const urls = loadE2EUrls();
  setApiBaseUrl(urls.gatewayUrl);
  mock = new MockControl(urls.mockUrl);
  await mock.reset();

  // Create a key for task operations.
  const keyResult = await createApiKey(
    { label: 'e2e-tasks', expiresAt: null } as never,
    'e2e-admin-token',
  );
  if (keyResult.isOk()) {
    apiKey = keyResult.value.apiKey;
  } else {
    throw new Error('Failed to create API key for task e2e tests');
  }
});

afterAll(async () => {
  await mock.reset();
});

describe('POST /tasks (submit)', () => {
  it('submits a task and returns the submission response', async () => {
    await mock.reset();

    const result = await submitTask({
      apiKey,
      parseFields: samplePdfFormData(),
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const body = result.value;
    expect(body.taskId).toBeTruthy();
    expect(body.status).toBe('pending');
    expect(body.backend).toBeTruthy();
    expect(body.fileNames.length).toBeGreaterThanOrEqual(1);
    expect(body.statusUrl).toContain('/tasks/');
    expect(body.resultUrl).toContain('/result');
    // Response includes startedAt/completedAt/error, all null on submission.
    expect(body.startedAt).toBeNull();
    expect(body.completedAt).toBeNull();
    expect(body.error).toBeNull();
    expect(body.message).toContain('submitted');
  });

  it('returns 401 when no API key is provided', async () => {
    await mock.reset();

    const result = await submitTask({ parseFields: samplePdfFormData() });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;
    expect(result.error.status).toBe(401);
  });

  it('returns 401 with an invalid API key', async () => {
    await mock.reset();

    const result = await submitTask({
      apiKey: 'mru_invalidkey123',
      parseFields: samplePdfFormData(),
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;
    expect(result.error.status).toBe(401);
  });

  it('relays upstream error when upstream returns non-202', async () => {
    await mock.reset();
    // Configure the mock to return 500 for /tasks.
    await mock.setSubmitStatus(500);

    const result = await submitTask({
      apiKey,
      parseFields: samplePdfFormData(),
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;
    // The gateway relays the upstream error status.
    expect(result.error.status).toBe(500);
  });
});

describe('POST /file_parse (sync parse)', () => {
  it('returns the parsed result from the mock upstream', async () => {
    await mock.reset();

    const result = await parseFile({
      apiKey,
      parseFields: samplePdfFormData(),
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // parseFile returns RawResponse; read the body as JSON.
    const body = await result.value.reader.json();
    expect(body).toHaveProperty('markdown');
    expect(body).toHaveProperty('status', 'completed');
  });
});

describe('GET /tasks (list)', () => {
  it('lists submitted tasks with pagination', async () => {
    await mock.reset();
    await submitTask({ apiKey, parseFields: samplePdfFormData() });

    const result = await listTasks({ apiKey });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.total).toBeGreaterThanOrEqual(1);
    expect(result.value.page).toBe(1);
    expect(result.value.items.length).toBeGreaterThanOrEqual(1);

    const item = result.value.items[0];
    expect(item.taskId).toBeTruthy();
    expect(item.status).toBe('pending');
    expect(item.fileNames.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /tasks/stats', () => {
  it('returns task counters', async () => {
    await mock.reset();
    await submitTask({ apiKey, parseFields: samplePdfFormData() });

    const result = await getTaskStats(apiKey);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const stats = result.value;
    expect(typeof stats.pending).toBe('number');
    expect(typeof stats.completed).toBe('number');
    expect(typeof stats.failed).toBe('number');
    expect(typeof stats.totalBytes).toBe('number');
  });
});

describe('GET /tasks/{id} (detail)', () => {
  it('returns full task detail for an existing task', async () => {
    await mock.reset();
    const submitResult = await submitTask({ apiKey, parseFields: samplePdfFormData() });
    if (!submitResult.isOk()) throw new Error('submit failed');
    const taskId = submitResult.value.taskId;

    const result = await getTaskDetail(taskId, apiKey);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.taskId).toBe(taskId);
    expect(result.value.status).toBe('pending');
    expect(result.value.fileCount).toBeGreaterThanOrEqual(1);
    expect(result.value.backend).toBeTruthy();
    expect(result.value.retryCount).toBe(0);
  });

  it('returns 404 for a non-existent task', async () => {
    const result = await getTaskDetail('00000000-0000-0000-0000-000000000000', apiKey);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;
    expect(result.error.status).toBe(404);
  });
});

describe('DELETE /tasks/{id} (cancel)', () => {
  it('cancels a pending task', async () => {
    await mock.reset();
    const submitResult = await submitTask({ apiKey, parseFields: samplePdfFormData() });
    if (!submitResult.isOk()) throw new Error('submit failed');
    const taskId = submitResult.value.taskId;

    const result = await cancelTask(taskId, apiKey);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.taskId).toBe(taskId);
    expect(result.value.status).toBe('cancelled');
    expect(result.value.message).toBeTruthy();
  });

  it('returns 404 when cancelling a non-existent task', async () => {
    const result = await cancelTask('00000000-0000-0000-0000-000000000000', apiKey);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;
    expect(result.error.status).toBe(404);
  });
});

describe('POST /tasks/cancel (batch cancel)', () => {
  it('cancels multiple pending tasks', async () => {
    await mock.reset();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await submitTask({ apiKey, parseFields: samplePdfFormData() });
      if (r.isOk()) ids.push(r.value.taskId);
    }
    expect(ids.length).toBe(2);

    const result = await batchCancelTasks(ids, apiKey);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.cancelledCount).toBe(2);
    expect(result.value.cancelledIds.length).toBe(2);
    expect(result.value.errors.length).toBe(0);
  });
});
