import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import { validateUploadSize } from '../../src/utils/upload';

// The message assertions below pin the zh-CN dictionary; force it so the
// node `navigator.language` ("en-US") cannot leak into the default locale.
beforeEach(() => setLocale('zh-CN'));

const MB = 1024 * 1024;

const file = (name: string, sizeBytes: number): File =>
  ({ name, size: sizeBytes }) as File;

describe('validateUploadSize', () => {
  it('accepts files within the limit', () => {
    const result = validateUploadSize([file('a.pdf', 10 * MB)], 500 * MB);
    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBe(10 * MB);
  });

  it('accepts an empty selection', () => {
    const result = validateUploadSize([], 500 * MB);
    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBe(0);
  });

  it('rejects a single file over the per-file limit and names it', () => {
    const result = validateUploadSize([file('huge.pdf', 600 * MB)], 500 * MB);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('huge.pdf');
  });

  it('rejects a total over the limit even when each file is within it', () => {
    const result = validateUploadSize(
      [file('a.pdf', 300 * MB), file('b.pdf', 300 * MB)],
      500 * MB,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('超过单次上传上限');
  });

  it('reports the offending names only when files are individually oversized', () => {
    const result = validateUploadSize(
      [file('ok.pdf', 1 * MB), file('big.pdf', 600 * MB)],
      500 * MB,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('big.pdf');
    expect(result.message).not.toContain('ok.pdf');
  });
});
