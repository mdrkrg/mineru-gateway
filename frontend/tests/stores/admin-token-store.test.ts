/**
 * @file Contract for the AdminTokenStore (gateway admin token).
 *
 * - `token()` hydrates from sessionStorage key `"gateway_admin_token"`.
 * - `setToken(token)` persists and exposes the token.
 * - `clearToken()` removes it from state and sessionStorage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const sessionStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
  clear: vi.fn(() => { storage.clear(); }),
};
Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
});

import { createAdminTokenStore } from '../../src/stores/admin-token';

beforeEach(() => {
  storage.clear();
  sessionStorageMock.getItem.mockClear();
  sessionStorageMock.setItem.mockClear();
  sessionStorageMock.removeItem.mockClear();
});

describe('AdminTokenStore', () => {
  it('starts with null when sessionStorage is empty', () => {
    const store = createAdminTokenStore();
    expect(store.token()).toBeNull();
  });

  it('hydrates from sessionStorage', () => {
    storage.set('gateway_admin_token', 'adm-stored');
    const store = createAdminTokenStore();
    expect(store.token()).toBe('adm-stored');
  });

  it('setToken persists and exposes the token', () => {
    const store = createAdminTokenStore();
    store.setToken('adm-new');
    expect(store.token()).toBe('adm-new');
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'gateway_admin_token',
      'adm-new',
    );
  });

  it('clearToken removes the token from state and sessionStorage', () => {
    storage.set('gateway_admin_token', 'adm-stored');
    const store = createAdminTokenStore();
    store.clearToken();
    expect(store.token()).toBeNull();
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('gateway_admin_token');
  });
});
