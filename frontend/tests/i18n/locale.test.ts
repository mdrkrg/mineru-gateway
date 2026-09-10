/**
 * @file Contract for locale resolution and persistence.
 *
 * Invariants:
 * - Resolution order: localStorage["gateway_locale"] -> navigator language
 *   -> DEFAULT_LOCALE.
 * - Invalid persisted values are ignored.
 * - setLocale switches the signal and persists best-effort (storage
 *   failures never block the switch).
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

import { DEFAULT_LOCALE } from '../../src/i18n/locales';

/** Fresh module instance per test (the locale signal is module-level). */
async function fresh() {
  vi.resetModules();
  return import('../../src/i18n/locale');
}

beforeEach(() => {
  storage.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  // No navigator language by default; individual tests stub one.
  vi.stubGlobal('navigator', {});
});

describe('locale resolution', () => {
  it('falls back to the default locale when nothing is stored', async () => {
    const { locale } = await fresh();
    expect(locale()).toBe(DEFAULT_LOCALE);
  });

  it('uses the persisted locale when valid', async () => {
    storage.set('gateway_locale', 'en');
    const { locale } = await fresh();
    expect(locale()).toBe('en');
  });

  it('ignores an invalid persisted value', async () => {
    storage.set('gateway_locale', 'fr');
    const { locale } = await fresh();
    expect(locale()).toBe(DEFAULT_LOCALE);
  });

  it('detects from navigator when nothing is stored', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    const { locale } = await fresh();
    expect(locale()).toBe('en');
  });

  it('matches navigator by base language', async () => {
    vi.stubGlobal('navigator', { language: 'zh-TW' });
    const { locale } = await fresh();
    expect(locale()).toBe('zh-CN');
  });

  it('prefers the persisted locale over navigator', async () => {
    storage.set('gateway_locale', 'zh-CN');
    vi.stubGlobal('navigator', { language: 'en-US' });
    const { locale } = await fresh();
    expect(locale()).toBe('zh-CN');
  });

  it('falls back to the default locale when navigator has no language', async () => {
    const { locale } = await fresh();
    expect(locale()).toBe(DEFAULT_LOCALE);
  });
});

describe('setLocale', () => {
  it('switches the signal and persists', async () => {
    const { locale, setLocale } = await fresh();
    setLocale('en');
    expect(locale()).toBe('en');
    expect(storage.get('gateway_locale')).toBe('en');
  });

  it('still switches when persistence fails', async () => {
    const { locale, setLocale } = await fresh();
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    expect(() => setLocale('en')).not.toThrow();
    expect(locale()).toBe('en');
  });
});
