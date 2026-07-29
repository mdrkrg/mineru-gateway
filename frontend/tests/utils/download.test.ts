import { describe, expect, it } from 'vitest';
import { filenameFromContentDisposition } from '../../src/utils/download';

describe('filenameFromContentDisposition', () => {
  it('returns null for null/empty header', () => {
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition('')).toBeNull();
  });

  it('parses quoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename="result.zip"')).toBe(
      'result.zip',
    );
  });

  it('parses unquoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename=result.zip')).toBe(
      'result.zip',
    );
  });

  it('parses RFC 5987 filename* with URL decoding', () => {
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''%E7%BB%93%E6%9E%9C.zip"),
    ).toBe('结果.zip');
  });

  it('prefers filename* over filename when both present', () => {
    expect(
      filenameFromContentDisposition(
        "attachment; filename=\"fallback.zip\"; filename*=UTF-8''real.zip",
      ),
    ).toBe('real.zip');
  });

  it('returns null when no filename directive exists', () => {
    expect(filenameFromContentDisposition('attachment')).toBeNull();
  });
});
