import { describe, expect, it } from 'vitest';
import {
  extensionFromContentType,
  fallbackFilename,
  filenameFromContentDisposition,
  resultFilename,
} from '@/utils/download';

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

  it('returns .bin for null/undefined content type', () => {
    expect(extensionFromContentType(null)).toBe('.bin');
  });

  it('returns the text-family extensions', () => {
    expect(extensionFromContentType('text/plain')).toBe('.txt');
    expect(extensionFromContentType('text/markdown; charset=utf-8')).toBe('.md');
  });

  it('returns .bin for unknown content types', () => {
    expect(extensionFromContentType('image/png')).toBe('.bin');
    expect(extensionFromContentType('application/pdf')).toBe('.bin');
  });
});

describe('fallbackFilename', () => {
  it('reuses the original file name instead of the task id', () => {
    expect(fallbackFilename(['paper.pdf'], 'text/markdown')).toBe('paper.md');
    expect(fallbackFilename(['论文.pdf'], 'application/json')).toBe('论文.json');
  });

  it('strips directories and the last extension', () => {
    expect(fallbackFilename(['../inbox/draft.v2.pdf'], 'application/zip')).toBe(
      'draft.v2.zip',
    );
  });

  it('falls back to result.<ext> without file names', () => {
    expect(fallbackFilename([], 'application/json')).toBe('result.json');
  });
});

describe('resultFilename', () => {
  it('prefers the Content-Disposition filename', () => {
    const headers = new Headers({
      'Content-Disposition': 'attachment; filename="server.zip"',
      'Content-Type': 'application/zip',
    });

    expect(resultFilename(headers, ['paper.pdf'])).toBe('server.zip');
  });

  it('falls back to the original file name', () => {
    const headers = new Headers({ 'Content-Type': 'text/markdown' });

    expect(resultFilename(headers, ['paper.pdf'])).toBe('paper.md');
  });
});
