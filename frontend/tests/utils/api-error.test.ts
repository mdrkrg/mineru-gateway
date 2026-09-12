import { describe, expect, it } from 'vitest';
import { createHttpError } from '../../src/core/error-model';
import { errorMessage } from '../../src/utils/api-error';

describe('errorMessage: HTTP errors', () => {
  it('maps known backend details to actionable Chinese', () => {
    expect(errorMessage(createHttpError(401, { detail: 'Invalid credentials' }))).toBe(
      '邮箱或密码错误',
    );
    expect(errorMessage(createHttpError(401, { detail: 'Invalid API key' }))).toBe(
      'API Key 无效或已被吊销，请在 API Keys 页面重新设置',
    );
    expect(errorMessage(createHttpError(403, { detail: 'Email not verified' }))).toBe(
      '邮箱尚未验证，请先完成邮箱验证',
    );
    expect(errorMessage(createHttpError(404, { detail: 'Task not found' }))).toBe(
      '任务不存在或已被清理',
    );
  });

  it('falls back to the status message for unknown details', () => {
    expect(errorMessage(createHttpError(429, { detail: 'rate limited' }))).toBe(
      '操作过于频繁，请稍后重试',
    );
    expect(errorMessage(createHttpError(413, {}))).toBe('上传内容超过大小上限');
    expect(
      errorMessage(createHttpError(413, { detail: 'Upload exceeds max size (524288000 bytes)' })),
    ).toBe('上传内容超过大小上限（500 MB）');
    expect(errorMessage(createHttpError(503, {}))).toBe('服务繁忙，请稍后重试');
  });

  it('falls back to a generic message for unknown statuses', () => {
    expect(errorMessage(createHttpError(418, {}))).toBe('请求失败（HTTP 418）');
  });

  it('ignores a non-string detail', () => {
    expect(errorMessage(createHttpError(500, { detail: 42 }))).toBe(
      '服务器内部错误，请稍后重试',
    );
  });
});

describe('errorMessage: infrastructure errors', () => {
  it('maps network errors', () => {
    expect(errorMessage({ _type: 'NetworkError', error: new Error('x') })).toBe(
      '网络连接失败，请检查网络后重试',
    );
  });

  it('maps validation errors', () => {
    expect(
      errorMessage({
        _type: 'ValidationError',
        status: null,
        summary: 'bad shape',
        issues: null,
      }),
    ).toBe('响应数据格式异常，请稍后重试');
  });

  it('maps unhandled status errors by status', () => {
    expect(
      errorMessage({ _type: 'UnhandledStatusError', status: 502, data: {} }),
    ).toBe('上游服务暂时不可用，请稍后重试');
  });

  it('maps unexpected errors', () => {
    expect(errorMessage({ _type: 'UnexpectedError', error: new Error('x') })).toBe(
      '发生未知错误，请重试',
    );
  });
});
