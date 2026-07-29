import { describe, expect, it } from 'vitest';
import {
  EMPTY_PLACEHOLDER,
  formatDateTime,
  formatDuration,
  formatFileSize,
} from '../../src/utils/format';

describe('formatDateTime', () => {
  it('returns placeholder for null/undefined/empty input', () => {
    expect(formatDateTime(null)).toBe(EMPTY_PLACEHOLDER);
    expect(formatDateTime(undefined)).toBe(EMPTY_PLACEHOLDER);
    expect(formatDateTime('')).toBe(EMPTY_PLACEHOLDER);
  });

  it('returns placeholder for unparseable input', () => {
    expect(formatDateTime('not-a-date')).toBe(EMPTY_PLACEHOLDER);
  });

  it('formats an ISO timestamp as YYYY-MM-DD HH:mm:ss local time', () => {
    const result = formatDateTime('2026-07-29T10:05:03');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(result).toContain('2026-07-29');
  });
});

describe('formatFileSize', () => {
  it('formats zero and sub-KB values in bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('formats KB/MB/GB with one decimal when needed', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3 GB');
  });

  it('clamps at TB for very large values', () => {
    expect(formatFileSize(2048 * 1024 ** 4)).toBe('2048 TB');
  });

  it('returns placeholder for negative or non-finite input', () => {
    expect(formatFileSize(-1)).toBe(EMPTY_PLACEHOLDER);
    expect(formatFileSize(Number.NaN)).toBe(EMPTY_PLACEHOLDER);
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe(EMPTY_PLACEHOLDER);
  });
});

describe('formatDuration', () => {
  it('formats seconds only for short durations', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:45Z')).toBe('45秒');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:02:05Z')).toBe('2分 5秒');
  });

  it('formats hours, minutes and seconds', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T01:02:03Z')).toBe(
      '1小时 2分 3秒',
    );
  });

  it('shows 0秒 for zero-length durations', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe('0秒');
  });

  it('measures up to now when end is null/undefined', () => {
    const now = new Date('2026-01-01T00:01:30Z');
    expect(formatDuration('2026-01-01T00:00:00Z', null, now)).toBe('1分 30秒');
    expect(formatDuration('2026-01-01T00:00:00Z', undefined, now)).toBe('1分 30秒');
  });

  it('returns placeholder for unparseable or negative input', () => {
    expect(formatDuration('nope', '2026-01-01T00:00:00Z')).toBe(EMPTY_PLACEHOLDER);
    expect(formatDuration('2026-01-01T00:01:00Z', '2026-01-01T00:00:00Z')).toBe(
      EMPTY_PLACEHOLDER,
    );
  });
});
