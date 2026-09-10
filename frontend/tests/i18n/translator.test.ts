/**
 * @file Contract for the translator.
 *
 * Invariants:
 * - `t` resolves keys in the current locale.
 * - `{{ name }}` placeholders are replaced by the args object.
 * - Locale switches are picked up reactively (t tracks the locale signal).
 * - Both dictionaries have identical key sets (runtime guard mirroring the
 *   compile-time `Dict` constraint).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
  clear: vi.fn(() => { storage.clear(); }),
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('navigator', {});
});

describe('t', () => {
  it('resolves a key in the default locale', async () => {
    const { t } = await import('../../src/i18n');
    expect(t('common.loading')).toBe('加载中…');
  });

  it('resolves template arguments', async () => {
    const { t } = await import('../../src/i18n');
    expect(t('errors.httpDetail', { status: 401, detail: 'Unauthorized' })).toBe(
      'HTTP 401: Unauthorized',
    );
  });

  it('follows locale switches', async () => {
    const { t, setLocale } = await import('../../src/i18n');
    setLocale('en');
    expect(t('common.loading')).toBe('Loading…');
    setLocale('zh-CN');
    expect(t('common.loading')).toBe('加载中…');
  });
});

describe('dictionary key parity', () => {
  it('zh-CN implements exactly the keys of the reference dictionary', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });
});
