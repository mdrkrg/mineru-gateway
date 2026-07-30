import { describe, expect, it } from 'vitest';
import { filenameFromContentDisposition, extensionFromContentType } from '@/utils/download';

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

describe('extensionFromContentType', () => {
  it('returns .json for application/json', () => {
    expect(extensionFromContentType('application/json')).toBe('.json');
  });

  it('returns .json for application/json with charset', () => {
    expect(extensionFromContentType('application/json; charset=utf-8')).toBe('.json');
  });

  it('returns .zip for application/zip', () => {
    expect(extensionFromContentType('application/zip')).toBe('.zip');
  });

  it('returns .zip for null/undefined content type', () => {
    expect(extensionFromContentType(null)).toBe('.zip');
  });

  it('returns .bin for unknown content types', () => {
    expect(extensionFromContentType('text/plain')).toBe('.bin');
    expect(extensionFromContentType('image/png')).toBe('.bin');
    expect(extensionFromContentType('application/pdf')).toBe('.bin');
  });
});
