import { createSignal, createMemo } from 'solid-js';
import { login as apiLogin, refreshToken as apiRefreshToken, logout as apiLogout, getCurrentUser } from '@/api/functions/auth';
import type { UserRead } from '@/api/schemas/auth';
import { isHttpError } from '@/core/error-model';
import { errorMessage } from '@/utils/api-error';

export interface AuthStore {
  user: () => UserRead | null;
  accessToken: () => string | null;
  refreshToken: () => string | null;
  isLoading: () => boolean;
  isAuthenticated: () => boolean;
  error: () => string | null;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
  refreshUser: () => Promise<void>;
}

/**
 * Optional wiring for {@link createAuthStore}.
 *
 * Decouples the auth store from sibling credential stores (e.g. the active
 * API key store). Kept as a callback so the auth store stays the single
 * source of truth without importing other stores directly.
 */
export interface AuthStoreOptions {
  /**
   * Invoked whenever the session is cleared (logout, expired/invalid tokens).
   * Sibling credential stores should drop any credential scoped to the
   * previous user here to prevent cross-account leakage.
   */
  onSessionCleared?: () => void;
}

// TODO: Migrate token management to BFF

const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';

/** HTTP statuses that mean the JWT session is no longer usable. */
const DEAD_SESSION_STATUSES = new Set([401, 403]);

function readTokens(): { accessToken: string | null; refreshToken: string | null } {
  return {
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

function persistTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

function persistAccessToken(at: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, at);
}

function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function createAuthStore(options: AuthStoreOptions = {}): AuthStore {
  const [user, setUser] = createSignal<UserRead | null>(null);
  const [accessToken, setAccessToken] = createSignal<string | null>(null);
  const [refreshToken, setRefreshToken] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const isAuthenticated = createMemo(() => accessToken() !== null);

  /**
   * Terminates the client-side session: clears user + tokens from state and
   * localStorage, then notifies siblings (see {@link AuthStoreOptions}).
   */
  function clearSession() {
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    clearTokens();
    options.onSessionCleared?.();
  }

  async function init() {
    setIsLoading(true);
    setError(null);

    const tokens = readTokens();
    if (!tokens.accessToken || !tokens.refreshToken) {
      setIsLoading(false);
      return;
    }

    setAccessToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);

    const result = await getCurrentUser();
    if (result.isErr()) {
      if (isHttpError(result.error) && result.error.status === 401) {
        clearSession();
      }
      setError(errorMessage(result.error));
    } else {
      setUser(result.value);
    }

    setIsLoading(false);
  }

  async function login(email: string, password: string) {
    setIsLoading(true);
    setError(null);

    const result = await apiLogin({ email, password: password });
    if (result.isErr()) {
      setError(errorMessage(result.error));
      setIsLoading(false);
      return;
    }

    const { accessToken: at, refreshToken: rt } = result.value;
    await loginWithTokens(at, rt);
  }

  async function loginWithTokens(at: string, rt: string) {
    setIsLoading(true);
    setError(null);

    const userResult = await getCurrentUser(at);
    if (userResult.isErr()) {
      setUser(null);
      setError(errorMessage(userResult.error));
      setIsLoading(false);
      return;
    }

    persistTokens(at, rt);
    setAccessToken(at);
    setRefreshToken(rt);
    setUser(userResult.value);
    setIsLoading(false);
  }

  async function logout() {
    if (!accessToken()) return;

    setIsLoading(true);
    setError(null);

    const result = await apiLogout();

    clearSession();

    if (result.isErr()) {
      setError(errorMessage(result.error));
    }

    setIsLoading(false);
  }

  async function refresh(): Promise<string | null> {
    const rt = refreshToken();
    if (!rt) return null;

    setIsLoading(true);
    setError(null);

    const result = await apiRefreshToken({ refreshToken: rt });
    if (result.isErr()) {
      const err = result.error;
      // Only 401/403 mean the refresh token is dead; network and server
      // errors keep the session (and the active API key) intact.
      if (isHttpError(err) && DEAD_SESSION_STATUSES.has(err.status)) {
        clearSession();
      }
      setError(errorMessage(err));
      setIsLoading(false);
      // Return null whenever no fresh access token was obtained. Callers (the
      // 401 retry hook) must not retry with the stale token, or a transient
      // refresh failure turns into an endless 401 -> refresh -> 401 loop.
      return null;
    }

    const { accessToken: at } = result.value;
    persistAccessToken(at);
    setAccessToken(at);
    setIsLoading(false);
    return at;
  }

  async function refreshUser() {
    setError(null);

    const result = await getCurrentUser();
    if (result.isErr()) {
      if (isHttpError(result.error) && result.error.status === 401) {
        clearSession();
      }
      setError(errorMessage(result.error));
      return;
    }
    setUser(result.value);
  }

  return {
    user,
    accessToken,
    refreshToken,
    isLoading,
    isAuthenticated,
    error,
    init,
    login,
    loginWithTokens,
    logout,
    refresh,
    refreshUser,
  };
}
