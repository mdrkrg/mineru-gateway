import { afterEach, describe, expect, it, vi } from 'vitest';
import { newIdempotencyKey } from '../../src/utils/idempotency';

afterEach(() => vi.unstubAllGlobals());

describe('newIdempotencyKey', () => {
  it('uses randomUUID when available', () => {
    const randomUUID = vi.fn(() => 'key-from-randomUUID');
    vi.stubGlobal('crypto', { randomUUID });

    expect(newIdempotencyKey()).toBe('key-from-randomUUID');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('falls back to getRandomValues outside a secure context', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(newIdempotencyKey()).toBe('ab'.repeat(16));
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
});
