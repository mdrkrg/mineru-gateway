import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from 'neverthrow';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  parseJson: vi.fn(),
  parseBlob: vi.fn(),
  passthrough: vi.fn(),
  fetchAndValidate: vi.fn(),
  fetchBinaryAndValidate: vi.fn(),
  validateRequest: vi.fn(),
  validateSuccess: vi.fn(),
}));

vi.mock('@/core/http-client', () => ({
  request: mocks.request,
  parseJson: mocks.parseJson,
  parseBlob: mocks.parseBlob,
  passthrough: mocks.passthrough,
}));

vi.mock('@/core/validation', () => ({
  fetchAndValidate: mocks.fetchAndValidate,
  fetchBinaryAndValidate: mocks.fetchBinaryAndValidate,
  validateRequest: mocks.validateRequest,
  validateSuccess: mocks.validateSuccess,
}));

import {
  downloadResultZip,
  downloadTaskResult,
  getRawTaskResult,
  TASK_RESULT_TIMEOUT_MS,
} from '@/api/functions/tasks';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockReturnValue(ok({}));
  mocks.parseBlob.mockReturnValue(ok({}));
  mocks.validateRequest.mockReturnValue(() => ok({ taskIds: ['task-1'] }));
  mocks.fetchBinaryAndValidate.mockReturnValue(ok({}));
});

describe('task result downloads', () => {
  // Wiring tests: the transport is mocked, so these assert the timeout option
  // rather than real ky timeout behaviour.
  it('uses a timeout above the ky default', () => {
    expect(TASK_RESULT_TIMEOUT_MS).toBeGreaterThan(10_000);
  });

  it('targets the artifact endpoint and the raw JSON result', async () => {
    await downloadTaskResult('task-1', 'key');
    await getRawTaskResult('task-1', 'key');

    expect(mocks.request).toHaveBeenCalledWith('v1/tasks/task-1/download', {
      headers: { 'X-API-Key': 'key' },
      timeout: TASK_RESULT_TIMEOUT_MS,
    });
    expect(mocks.request).toHaveBeenCalledWith('v1/tasks/task-1/result', {
      headers: { 'X-API-Key': 'key' },
      searchParams: { response_format: 'json' },
      timeout: TASK_RESULT_TIMEOUT_MS,
    });
  });

  it('omits X-API-Key when the web UI uses its JWT', async () => {
    await downloadTaskResult('task-1');

    expect(mocks.request).toHaveBeenCalledWith('v1/tasks/task-1/download', {
      headers: {},
      timeout: TASK_RESULT_TIMEOUT_MS,
    });
  });

  it('gives result-zip downloads more than the ky default', async () => {
    await downloadResultZip(['task-1'], 'key');

    expect(mocks.fetchBinaryAndValidate).toHaveBeenCalledWith(
      'v1/tasks/result-zip',
      expect.objectContaining({ failures: expect.any(Object) }),
      {
        method: 'POST',
        json: { taskIds: ['task-1'] },
        headers: { 'X-API-Key': 'key' },
        timeout: TASK_RESULT_TIMEOUT_MS,
      },
    );
  });
});
