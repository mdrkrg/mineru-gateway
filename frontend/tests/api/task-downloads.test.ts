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
  getTaskResult,
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

  it('gives single-result downloads more than the ky default', async () => {
    await getTaskResult('task-1', 'key');

    expect(mocks.request).toHaveBeenCalledWith('tasks/task-1/result', {
      headers: { 'X-API-Key': 'key' },
      timeout: TASK_RESULT_TIMEOUT_MS,
    });
  });

  it('gives result-zip downloads more than the ky default', async () => {
    await downloadResultZip(['task-1'], 'key');

    expect(mocks.fetchBinaryAndValidate).toHaveBeenCalledWith(
      'tasks/result-zip',
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
