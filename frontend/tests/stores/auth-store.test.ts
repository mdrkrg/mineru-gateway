/**
 * @file Contract for the AuthStore (SolidJS context + signals).
 *
 * ## Overall behaviour
 *
 * The AuthStore is the single source of truth for authentication state.
 * It wraps the gateway API layer (`login`, `refreshToken`, `logout`,
 * `getCurrentUser` from `api/functions/auth.ts`) and exposes reactive
 * signals + actions to the component tree via SolidJS Context.
 *
 * ### State (reactive signals)
 *
 * - `user` - the current user profile (`UserRead | null`).
 * - `accessToken` - JWT access token (`string | null`).
 * - `refreshToken` - JWT refresh token (`string | null`).
 * - `isLoading` - `true` while any async operation is in flight.
 * - `isAuthenticated` - derived: `true` when `accessToken` is non-null.
 * - `error` - the last error from any action (`string | null`), cleared on
 *   the next action.
 *
 * ### Actions (async functions that mutate state)
 *
 * - `init()` - hydrate from localStorage. If tokens exist, call
 *   `getCurrentUser` to validate the session and populate `user`.
 * - `login(email, password)` - POST `/auth/jwt/login`, store tokens in
 *   localStorage, fetch user profile.
 * - `logout()` - POST `/auth/jwt/logout`, clear tokens + user from state
 *   and localStorage.
 * - `refresh()` - POST `/auth/jwt/refresh` with the current `refreshToken`,
 *   update `accessToken` in state and localStorage.
 *
 * ### Persistence
 *
 * - `accessToken` is stored under `localStorage` key `"auth_access_token"`.
 * - `refreshToken` is stored under `localStorage` key `"auth_refresh_token"`.
 * - On `login()` success, both keys are written.
 * - On `refresh()` success, the access token key is updated.
 * - On `logout()`, both keys are removed.
 * - On `init()`, both keys are read; if tokens exist, `getCurrentUser` is
 *   called to validate.
 *
 * ### Error handling
 *
 * - HTTP errors (401, 404, 500, etc.) are stored in `error` as a string.
 * - Network errors are stored in `error` as a human-readable string.
 * - Validation errors are stored in `error`.
 * - `error` is cleared to `null` at the start of every action.
 * - On `login` failure, tokens are NOT stored and `user` remains `null`.
 * - On `init` failure (stale/invalid tokens), tokens are cleared.
 * - On `refresh` failure, tokens are cleared (session expired).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockKy } from '../core/ky-mock';

vi.mock('ky', async () => {
  const { createKyMock } = await import('../core/ky-mock');
  return createKyMock();
});

import ky from 'ky';
import { HTTPError, NetworkError } from '../core/ky-mock';

const m = ky as unknown as MockKy;

// localStorage mock (node environment has no localStorage)
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

import { createAuthStore } from '../../src/stores/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  m.mockReset();
  storage.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------

describe('AuthStore: init', () => {
  /**
   * On init with no tokens in localStorage, the store starts
   * unauthenticated with null user/tokens and calls no API.
   */
  it('starts unauthenticated when localStorage is empty', async () => {
    const store = createAuthStore();

    await store.init();

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.accessToken()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.isLoading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(m).not.toHaveBeenCalled();
  });

  /**
   * On init with valid tokens in localStorage, the store fetches
   * the current user profile and populates user + tokens.
   */
  it('hydrates user when valid tokens exist in localStorage', async () => {
    storage.set('auth_access_token', 'at-valid');
    storage.set('auth_refresh_token', 'rt-valid');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u1',
          email: 'a@b.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: 'Alice',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const store = createAuthStore();
    await store.init();

    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('at-valid');
    expect(store.refreshToken()).toBe('rt-valid');
    const user = store.user() as Record<string, unknown>;
    expect(user?.email).toBe('a@b.com');
    expect(store.isLoading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  /**
   * On init with tokens that are expired/invalid (401 from getCurrentUser),
   * the store clears tokens and starts unauthenticated.
   */
  it('clears tokens when stored tokens are invalid (401)', async () => {
    storage.set('auth_access_token', 'at-expired');
    storage.set('auth_refresh_token', 'rt-expired');

    const httpErr = new HTTPError(
      new Response(JSON.stringify({ detail: 'token expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'token expired' };
    m.mockRejectedValueOnce(httpErr);

    const store = createAuthStore();
    await store.init();

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.accessToken()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.error()).toBeTruthy();
    expect(storage.has('auth_access_token')).toBe(false);
    expect(storage.has('auth_refresh_token')).toBe(false);
  });

  /**
   * On init with tokens but a network error, the store retains
   * the tokens (offline fallback) and sets an error.
   */
  it('retains tokens on network error during init', async () => {
    storage.set('auth_access_token', 'at-net');
    storage.set('auth_refresh_token', 'rt-net');

    m.mockRejectedValueOnce(new NetworkError('offline', { cause: new Error('dns') }));

    const store = createAuthStore();
    await store.init();

    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('at-net');
    expect(store.refreshToken()).toBe('rt-net');
    expect(store.user()).toBeNull();
    expect(store.error()).toBeTruthy();
    expect(storage.has('auth_access_token')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// login()
// ---------------------------------------------------------------------------

describe('AuthStore: login', () => {
  /**
   * Successful login stores tokens in localStorage, fetches the
   * user profile, and sets isAuthenticated to true.
   */
  it('stores tokens and user on successful login', async () => {
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'at-login',
          refresh_token: 'rt-login',
          token_type: 'bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u2',
          email: 'b@c.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: 'Bob',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const store = createAuthStore();
    await store.login('b@c.com', 'secret');

    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('at-login');
    expect(store.refreshToken()).toBe('rt-login');
    const user = store.user() as Record<string, unknown>;
    expect(user?.email).toBe('b@c.com');
    expect(store.isLoading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(storage.get('auth_access_token')).toBe('at-login');
    expect(storage.get('auth_refresh_token')).toBe('rt-login');
  });

  /**
   * Failed login (401) does NOT store tokens, sets error, and
   * keeps isAuthenticated false.
   */
  it('does not store tokens on failed login (401)', async () => {
    const httpErr = new HTTPError(
      new Response(JSON.stringify({ detail: 'bad credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'bad credentials' };
    m.mockRejectedValueOnce(httpErr);

    const store = createAuthStore();
    await store.login('bad@c.com', 'wrong');

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.accessToken()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.error()).toBeTruthy();
    expect(storage.has('auth_access_token')).toBe(false);
    expect(storage.has('auth_refresh_token')).toBe(false);
  });

  /**
   * On network error during login, no tokens are stored and error is set.
   */
  it('sets error on network failure during login', async () => {
    m.mockRejectedValueOnce(new NetworkError('offline', { cause: new Error('dns') }));

    const store = createAuthStore();
    await store.login('b@c.com', 'secret');

    expect(store.isAuthenticated()).toBe(false);
    expect(store.error()).toBeTruthy();
    expect(storage.has('auth_access_token')).toBe(false);
  });

  /**
   * error is cleared to null when a new login attempt starts.
   */
  it('clears previous error on new login attempt', async () => {
    const httpErr = new HTTPError(
      new Response(JSON.stringify({ detail: 'bad' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'bad' };
    m.mockRejectedValueOnce(httpErr);
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'at-ok',
          refresh_token: 'rt-ok',
          token_type: 'bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u3',
          email: 'c@d.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const store = createAuthStore();
    await store.login('bad@c.com', 'wrong');
    expect(store.error()).toBeTruthy();

    await store.login('c@d.com', 'correct');
    expect(store.error()).toBeNull();
    expect(store.isAuthenticated()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// logout()
// ---------------------------------------------------------------------------

describe('AuthStore: logout', () => {
  /**
   * Logout clears user, tokens, and localStorage, and sets
   * isAuthenticated to false.
   */
  it('clears all state and localStorage on logout', async () => {
    storage.set('auth_access_token', 'at-out');
    storage.set('auth_refresh_token', 'rt-out');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u4',
          email: 'd@e.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: 'Dan',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'logged out' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const store = createAuthStore();
    await store.init();
    expect(store.isAuthenticated()).toBe(true);

    await store.logout();

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.accessToken()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.isLoading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(storage.has('auth_access_token')).toBe(false);
    expect(storage.has('auth_refresh_token')).toBe(false);
  });

  /**
   * Logout clears state even if the API call fails (e.g. network
   * error). The client-side session is always terminated.
   */
  it('clears state even if the logout API call fails', async () => {
    storage.set('auth_access_token', 'at-force');
    storage.set('auth_refresh_token', 'rt-force');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-force',
          email: 'force@example.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockRejectedValueOnce(new NetworkError('offline', { cause: new Error('dns') }));

    const store = createAuthStore();
    await store.init();
    expect(store.isAuthenticated()).toBe(true);

    await store.logout();

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(storage.has('auth_access_token')).toBe(false);
  });

  /**
   * Logout when already unauthenticated is a no-op (no API call,
   * no state change).
   */
  it('is a no-op when already unauthenticated', async () => {
    const store = createAuthStore();
    await store.init();

    await store.logout();

    expect(store.isAuthenticated()).toBe(false);
    expect(m).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// refresh()
// ---------------------------------------------------------------------------

describe('AuthStore: refresh', () => {
  /**
   * Refresh updates the accessToken in state and localStorage
   * using the stored refreshToken.
   */
  it('updates accessToken on successful refresh', async () => {
    storage.set('auth_access_token', 'at-old');
    storage.set('auth_refresh_token', 'rt-good');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u5',
          email: 'e@f.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: 'Eve',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'at-new',
          token_type: 'bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const store = createAuthStore();
    await store.init();
    await store.refresh();

    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('at-new');
    expect(store.refreshToken()).toBe('rt-good');
    expect(storage.get('auth_access_token')).toBe('at-new');
    expect(store.error()).toBeNull();
  });

  /**
   * On refresh failure (401), all tokens are cleared and the
   * session is terminated.
   */
  it('clears tokens on refresh failure (401)', async () => {
    storage.set('auth_access_token', 'at-stale');
    storage.set('auth_refresh_token', 'rt-stale');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-stale',
          email: 'stale@example.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const httpErr = new HTTPError(
      new Response(JSON.stringify({ detail: 'refresh token expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'refresh token expired' };
    m.mockRejectedValueOnce(httpErr);

    const store = createAuthStore();
    await store.init();
    await store.refresh();

    expect(store.isAuthenticated()).toBe(false);
    expect(store.accessToken()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.error()).toBeTruthy();
    expect(storage.has('auth_access_token')).toBe(false);
    expect(storage.has('auth_refresh_token')).toBe(false);
  });

  /**
   * Refresh is a no-op when there is no refreshToken.
   */
  it('is a no-op when no refresh token is available', async () => {
    const store = createAuthStore();
    await store.init();

    await store.refresh();

    expect(store.isAuthenticated()).toBe(false);
    expect(m).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// isAuthenticated (derived)
// ---------------------------------------------------------------------------

describe('AuthStore: isAuthenticated', () => {
  /**
   * isAuthenticated is false initially (before init).
   */
  it('is false initially', () => {
    const store = createAuthStore();
    expect(store.isAuthenticated()).toBe(false);
  });

  /**
   * isAuthenticated is true after login succeeds.
   */
  it('is true after successful login', async () => {
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'at-auth',
          refresh_token: 'rt-auth',
          token_type: 'bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u6',
          email: 'f@g.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const store = createAuthStore();
    expect(store.isAuthenticated()).toBe(false);
    await store.login('f@g.com', 'pw');
    expect(store.isAuthenticated()).toBe(true);
  });

  /**
   * isAuthenticated is false after logout.
   */
  it('is false after logout', async () => {
    storage.set('auth_access_token', 'at-auth2');
    storage.set('auth_refresh_token', 'rt-auth2');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u7',
          email: 'g@h.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'logged out' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const store = createAuthStore();
    await store.init();
    expect(store.isAuthenticated()).toBe(true);
    await store.logout();
    expect(store.isAuthenticated()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isLoading
// ---------------------------------------------------------------------------

describe('AuthStore: isLoading', () => {
  /**
   * isLoading is false after init completes (success or failure).
   */
  it('is false after init completes', async () => {
    const store = createAuthStore();
    await store.init();
    expect(store.isLoading()).toBe(false);
  });

  /**
   * isLoading is false after login completes (success or failure).
   */
  it('is false after login completes', async () => {
    m.mockRejectedValueOnce(new NetworkError('offline', { cause: new Error('dns') }));

    const store = createAuthStore();
    await store.login('x@y.com', 'pw');
    expect(store.isLoading()).toBe(false);
  });

  /**
   * isLoading is false after logout completes.
   */
  it('is false after logout completes', async () => {
    storage.set('auth_access_token', 'at-load');
    storage.set('auth_refresh_token', 'rt-load');

    m.mockRejectedValueOnce(new NetworkError('offline', { cause: new Error('dns') }));

    const store = createAuthStore();
    await store.logout();
    expect(store.isLoading()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// localStorage key names
// ---------------------------------------------------------------------------

describe('AuthStore: localStorage keys', () => {
  /**
   * Tokens are stored under the keys "auth_access_token" and
   * "auth_refresh_token".
   */
  it('uses "auth_access_token" and "auth_refresh_token" keys', async () => {
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'at-key',
          refresh_token: 'rt-key',
          token_type: 'bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u8',
          email: 'h@i.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const store = createAuthStore();
    await store.login('h@i.com', 'pw');

    expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_access_token', 'at-key');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_refresh_token', 'rt-key');
  });

  /**
   * Logout removes both keys.
   */
  it('removes both keys on logout', async () => {
    storage.set('auth_access_token', 'at-rm');
    storage.set('auth_refresh_token', 'rt-rm');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-rm',
          email: 'rm@example.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'logged out' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const store = createAuthStore();
    await store.init();
    await store.logout();

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_access_token');
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_refresh_token');
  });
});
