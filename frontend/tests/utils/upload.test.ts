import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n';
import { validateUploadSize } from '../../src/utils/upload';

// The message assertions below pin the zh-CN dictionary; force it so the
// node `navigator.language` ("en-US") cannot leak into the default locale.
beforeEach(() => setLocale('zh-CN'));

const MB = 1024 * 1024;

const file = (name: string, sizeBytes: number): File =>
  ({ name, size: sizeBytes }) as File;

const limits = {
  maxTotalBytes: 500 * MB,
  maxFileBytes: 200 * MB,
  maxFiles: 100,
};

describe('validateUploadSize', () => {
  it('accepts files within the limit', () => {
    const result = validateUploadSize([file('a.pdf', 10 * MB)], limits);
    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBe(10 * MB);
  });

  it('accepts an empty selection', () => {
    const result = validateUploadSize([], limits);
    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBe(0);
  });

  it('rejects a single file over the per-file limit and names it', () => {
    const result = validateUploadSize([file('huge.pdf', 300 * MB)], limits);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('huge.pdf');
  });

  it('rejects a total over the limit even when each file is within it', () => {
    const result = validateUploadSize(
      [file('a.pdf', 300 * MB), file('b.pdf', 300 * MB)],
      { ...limits, maxFileBytes: 400 * MB },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('超过单次上传上限');
  });

  it('joins the offending names with the locale list separator', () => {
    setLocale('en');
    const result = validateUploadSize(
      [file('big.pdf', 600 * MB), file('huge.pdf', 700 * MB)],
      limits,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('big.pdf, huge.pdf');
  });

  it('reports the offending names only when files are individually oversized', () => {
    const result = validateUploadSize(
      [file('ok.pdf', 1 * MB), file('big.pdf', 600 * MB)],
      limits,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('big.pdf');
    expect(result.message).not.toContain('ok.pdf');
  });

  it('rejects more than MinerU\'s 100-file limit', () => {
    const files = Array.from({ length: 101 }, (_, index) =>
      file(`${index}.pdf`, 1),
    );
    const result = validateUploadSize(files, limits);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('101');
    expect(result.message).toContain('100');
  });
});
