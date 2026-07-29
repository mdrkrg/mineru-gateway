/**
 * @file Contract for the ApiKeyStore (active API key for task endpoints).
 *
 * - `activeKey()` hydrates from localStorage key `"gateway_active_api_key"`.
 * - `setActiveKey(key)` persists and exposes the key.
 * - `clearActiveKey()` removes it from state and localStorage.
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
});

import { createApiKeyStore } from '../../src/stores/api-key';

beforeEach(() => {
  storage.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
});

describe('ApiKeyStore', () => {
  it('starts with null when localStorage is empty', () => {
    const store = createApiKeyStore();
    expect(store.activeKey()).toBeNull();
  });

  it('hydrates from localStorage', () => {
    storage.set('gateway_active_api_key', 'mk-stored');
    const store = createApiKeyStore();
    expect(store.activeKey()).toBe('mk-stored');
  });

  it('setActiveKey persists and exposes the key', () => {
    const store = createApiKeyStore();
    store.setActiveKey('mk-new');
    expect(store.activeKey()).toBe('mk-new');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'gateway_active_api_key',
      'mk-new',
    );
  });

  it('clearActiveKey removes the key from state and localStorage', () => {
    storage.set('gateway_active_api_key', 'mk-stored');
    const store = createApiKeyStore();
    store.clearActiveKey();
    expect(store.activeKey()).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('gateway_active_api_key');
  });
});
