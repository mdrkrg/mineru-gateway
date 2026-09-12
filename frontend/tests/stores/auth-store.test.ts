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
 * - `loginWithTokens(accessToken, refreshToken)` - store externally-obtained
 *   tokens (e.g. OAuth callback fragment) in localStorage, fetch user
 *   profile. On failure, roll back: clear tokens + state (same session
 *   validity guarantee as `init`).
 * - `logout()` - POST `/auth/jwt/logout`, clear tokens + user from state
 *   and localStorage.
 * - `refresh()` - POST `/auth/jwt/refresh` with the current `refreshToken`,
 *   update `accessToken` in state and localStorage.
 * - `refreshUser()` - GET `/users/me` with the current access token, update
 *   the `user` profile in state. On 401, clear the session (same semantics
 *   as `init`); on other errors, keep the session and set `error`. Does not
 *   touch tokens, `isLoading`, or localStorage.
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
 * ### Session-cleared callback
 *
 * `createAuthStore({ onSessionCleared })` accepts an optional callback invoked
 * whenever the client-side session is terminated: `logout()`, `init()` with
 * invalid/expired tokens (401), `refresh()` auth failure (401/403), and
 * `refreshUser()` 401. It is NOT invoked when a network or server error merely
 * preserves the session. The entry point wires it to clear the active API key
 * so a subsequent login by a different user cannot inherit the previous
 * user's key.
 *
 * ### Error handling
 *
 * - HTTP errors (401, 404, 500, etc.) are stored in `error` as a string.
 * - Network errors are stored in `error` as a human-readable string.
 * - Validation errors are stored in `error`.
 * - `error` is cleared to `null` at the start of every action.
 * - On `login` failure, tokens are NOT stored and `user` remains `null`.
 * - On `init` failure (stale/invalid tokens), tokens are cleared.
 * - On `refresh` auth failure (401/403), tokens are cleared (session expired);
 *   network and server errors keep the session.
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
// loginWithTokens()
// ---------------------------------------------------------------------------

describe('AuthStore: loginWithTokens', () => {
  /**
   * Stores externally-obtained tokens (OAuth callback) in localStorage,
   * fetches the user profile, and sets isAuthenticated to true.
   */
  it('stores tokens and fetches user on success', async () => {
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-oauth',
          email: 'oauth@example.com',
          is_active: true,
          is_superuser: false,
          is_verified: true,
          display_name: 'Olive',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const store = createAuthStore();
    await store.loginWithTokens('at-oauth', 'rt-oauth');

    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('at-oauth');
    expect(store.refreshToken()).toBe('rt-oauth');
    const user = store.user() as Record<string, unknown>;
    expect(user?.email).toBe('oauth@example.com');
    expect(store.isLoading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(storage.get('auth_access_token')).toBe('at-oauth');
    expect(storage.get('auth_refresh_token')).toBe('rt-oauth');
  });

  /**
   * When the user fetch fails, tokens are cleared from state and
   * localStorage — the caller must re-obtain them (same atomic
   * semantics as `init`).
   */
  it('clears tokens when user fetch fails', async () => {
    const httpErr = new HTTPError(
      new Response(JSON.stringify({ detail: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'unauthorized' };
    m.mockRejectedValueOnce(httpErr);

    const store = createAuthStore();
    await store.loginWithTokens('at-bad', 'rt-bad');

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.error()).toBeTruthy();
    expect(store.isLoading()).toBe(false);
    expect(storage.has('auth_access_token')).toBe(false);
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
    expect(await store.refresh()).toBe('at-new');

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
   * A transient network error during refresh keeps the session and does not
   * notify onSessionCleared (so the active API key survives).
   */
  it('keeps the session on a network error', async () => {
    storage.set('auth_access_token', 'at-net');
    storage.set('auth_refresh_token', 'rt-net');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-net',
          email: 'net@example.com',
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

    const onSessionCleared = vi.fn();
    const store = createAuthStore({ onSessionCleared });
    await store.init();
    onSessionCleared.mockClear();

    expect(await store.refresh()).toBeNull();

    expect(store.isAuthenticated()).toBe(true);
    expect(store.refreshToken()).toBe('rt-net');
    expect(storage.has('auth_refresh_token')).toBe(true);
    expect(store.error()).toBeTruthy();
    expect(onSessionCleared).not.toHaveBeenCalled();
  });

  /**
   * A server error during refresh is transient, so the session and the active
   * API key survive (only 401/403 mean the refresh token is dead).
   */
  it('keeps the session on a refresh server error', async () => {
    storage.set('auth_access_token', 'at-5xx');
    storage.set('auth_refresh_token', 'rt-5xx');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-5xx',
          email: '5xx@example.com',
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
    const err = new HTTPError(
      new Response(JSON.stringify({ detail: 'Service Unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    err.data = { detail: 'Service Unavailable' };
    m.mockRejectedValueOnce(err);

    const onSessionCleared = vi.fn();
    const store = createAuthStore({ onSessionCleared });
    await store.init();
    onSessionCleared.mockClear();

    await store.refresh();

    expect(store.isAuthenticated()).toBe(true);
    expect(store.refreshToken()).toBe('rt-5xx');
    expect(storage.has('auth_refresh_token')).toBe(true);
    expect(store.error()).toBeTruthy();
    expect(onSessionCleared).not.toHaveBeenCalled();
  });

  /**
   * Refresh is a no-op when there is no refreshToken.
   */
  it('is a no-op when no refresh token is available', async () => {
    const store = createAuthStore();
    await store.init();

    expect(await store.refresh()).toBeNull();

    expect(store.isAuthenticated()).toBe(false);
    expect(m).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// refreshUser()
// ---------------------------------------------------------------------------

describe('AuthStore: refreshUser', () => {
  /**
   * refreshUser refetches the profile and updates the user signal,
   * reflecting e.g. a freshly verified email without re-authenticating.
   */
  it('updates the user profile from the API', async () => {
    storage.set('auth_access_token', 'at-rf');
    storage.set('auth_refresh_token', 'rt-rf');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-rf',
          email: 'rf@example.com',
          is_active: true,
          is_superuser: false,
          is_verified: false,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-rf',
          email: 'rf@example.com',
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
    await store.init();
    expect(store.user()?.isVerified).toBe(false);

    await store.refreshUser();

    expect(store.isAuthenticated()).toBe(true);
    expect(store.user()?.isVerified).toBe(true);
    expect(store.error()).toBeNull();
    expect(storage.get('auth_access_token')).toBe('at-rf');
  });

  /**
   * On 401 from getCurrentUser, the session is cleared (stale tokens)
   * - same semantics as init.
   */
  it('clears the session on 401', async () => {
    storage.set('auth_access_token', 'at-rf401');
    storage.set('auth_refresh_token', 'rt-rf401');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-rf401',
          email: 'rf401@example.com',
          is_active: true,
          is_superuser: false,
          is_verified: false,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const httpErr = new HTTPError(
      new Response(JSON.stringify({ detail: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'unauthorized' };
    m.mockRejectedValueOnce(httpErr);

    const store = createAuthStore();
    await store.init();
    expect(store.isAuthenticated()).toBe(true);

    await store.refreshUser();

    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.error()).toBeTruthy();
    expect(storage.has('auth_access_token')).toBe(false);
    expect(storage.has('auth_refresh_token')).toBe(false);
  });

  /**
   * On a network error the session and the last known user are kept,
   * and the error is recorded.
   */
  it('keeps the session and user on network failure', async () => {
    storage.set('auth_access_token', 'at-rfnet');
    storage.set('auth_refresh_token', 'rt-rfnet');

    m.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u-rfnet',
          email: 'rfnet@example.com',
          is_active: true,
          is_superuser: false,
          is_verified: false,
          display_name: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    m.mockRejectedValueOnce(
      new NetworkError('offline', { cause: new Error('dns') }),
    );

    const store = createAuthStore();
    await store.init();
    expect(store.user()?.email).toBe('rfnet@example.com');

    await store.refreshUser();

    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('at-rfnet');
    expect(store.user()?.email).toBe('rfnet@example.com');
    expect(store.error()).toBeTruthy();
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

// ---------------------------------------------------------------------------
// onSessionCleared
// ---------------------------------------------------------------------------

describe('AuthStore: onSessionCleared', () => {
  const userBody = {
    id: 'u-sc',
    email: 'sc@example.com',
    is_active: true,
    is_superuser: false,
    is_verified: true,
    display_name: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  function unauthenticatedError(detail: string) {
    const err = new HTTPError(
      new Response(JSON.stringify({ detail }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    err.data = { detail };
    return err;
  }

  /**
   * Explicit logout notifies the sibling credential stores so the active
   * API key is dropped before another user logs in.
   */
  it('notifies on logout', async () => {
    storage.set('auth_access_token', 'at-sc');
    storage.set('auth_refresh_token', 'rt-sc');
    m.mockResolvedValueOnce(jsonResponse(userBody));
    m.mockResolvedValueOnce(jsonResponse({ message: 'logged out' }));

    const onSessionCleared = vi.fn();
    const store = createAuthStore({ onSessionCleared });
    await store.init();
    onSessionCleared.mockClear();

    await store.logout();
    expect(onSessionCleared).toHaveBeenCalledTimes(1);
  });

  /**
   * Stale tokens on init (401) clear the session and notify, so a key left
   * over from a previous session does not survive into the next login.
   */
  it('notifies when init clears invalid tokens (401)', async () => {
    storage.set('auth_access_token', 'at-sc401');
    storage.set('auth_refresh_token', 'rt-sc401');
    m.mockRejectedValueOnce(unauthenticatedError('token expired'));

    const onSessionCleared = vi.fn();
    const store = createAuthStore({ onSessionCleared });
    await store.init();

    expect(onSessionCleared).toHaveBeenCalledTimes(1);
  });

  /**
   * A failed refresh terminates the session and notifies.
   */
  it('notifies when refresh fails (401)', async () => {
    storage.set('auth_access_token', 'at-scrf');
    storage.set('auth_refresh_token', 'rt-scrf');
    m.mockResolvedValueOnce(jsonResponse(userBody));
    m.mockRejectedValueOnce(unauthenticatedError('refresh expired'));

    const onSessionCleared = vi.fn();
    const store = createAuthStore({ onSessionCleared });
    await store.init();
    onSessionCleared.mockClear();

    await store.refresh();
    expect(onSessionCleared).toHaveBeenCalledTimes(1);
  });

  /**
   * A 401 from the profile endpoint clears the session and notifies.
   */
  it('notifies when refreshUser clears the session (401)', async () => {
    storage.set('auth_access_token', 'at-scru');
    storage.set('auth_refresh_token', 'rt-scru');
    m.mockResolvedValueOnce(jsonResponse(userBody));
    m.mockRejectedValueOnce(unauthenticatedError('unauthorized'));

    const onSessionCleared = vi.fn();
    const store = createAuthStore({ onSessionCleared });
    await store.init();
    onSessionCleared.mockClear();

    await store.refreshUser();
    expect(onSessionCleared).toHaveBeenCalledTimes(1);
  });

  /**
   * A network error retains the session, so credentials must NOT be cleared.
   */
  it('does not notify when a network error retains the session', async () => {
    storage.set('auth_access_token', 'at-scnet');
    storage.set('auth_refresh_token', 'rt-scnet');
    m.mockRejectedValueOnce(new NetworkError('offline', { cause: new Error('dns') }));

    const onSessionCleared = vi.fn();
    const store = createAuthStore({ onSessionCleared });
    await store.init();

    expect(store.isAuthenticated()).toBe(true);
    expect(onSessionCleared).not.toHaveBeenCalled();
  });
});
