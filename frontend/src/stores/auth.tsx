import { createSignal, createMemo } from 'solid-js';
import { login as apiLogin, refreshToken as apiRefreshToken, logout as apiLogout, getCurrentUser } from '../api/functions/auth';
import type { UserRead } from '../api/schemas/auth';

export interface AuthStore {
  user: () => UserRead | null;
  accessToken: () => string | null;
  refreshToken: () => string | null;
  isLoading: () => boolean;
  isAuthenticated: () => boolean;
  error: () => string | null;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

// TODO: Migrate token management to BFF

const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';

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

function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && '_type' in error) {
    const err = error as Record<string, unknown>;
    if (err._type === 'HttpError') return `HTTP ${err.status}: ${(err as { data: { detail?: string } }).data?.detail ?? 'unknown'}`;
    if (err._type === 'NetworkError') return `${(err as { error: Error }).error?.message ?? 'Network error'}`;
    if (err._type === 'ValidationError') return (err as { summary: string }).summary ?? 'Validation error';
    if (err._type === 'UnhandledStatusError') return `Unexpected status ${err.status}`;
    if (err._type === 'UnexpectedError') return 'Unexpected error';
  }
  return 'Unknown error';
}

export function createAuthStore(): AuthStore {
  const [user, setUser] = createSignal<UserRead | null>(null);
  const [accessToken, setAccessToken] = createSignal<string | null>(null);
  const [refreshToken, setRefreshToken] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const isAuthenticated = createMemo(() => accessToken() !== null);

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

    const result = await getCurrentUser(tokens.accessToken);
    if (result.isErr()) {
      const err = result.error;
      if (err && typeof err === 'object' && '_type' in err && (err as Record<string, unknown>)._type === 'HttpError') {
        const httpErr = err as { status: number };
        if (httpErr.status === 401) {
          setUser(null);
          setAccessToken(null);
          setRefreshToken(null);
          clearTokens();
        }
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
    persistTokens(at, rt);
    setAccessToken(at);
    setRefreshToken(rt);

    const userResult = await getCurrentUser(at);
    if (userResult.isErr()) {
      setUser(null);
      setError(errorMessage(userResult.error));
    } else {
      setUser(userResult.value);
    }

    setIsLoading(false);
  }

  async function logout() {
    const at = accessToken();
    if (!at) return;

    setIsLoading(true);
    setError(null);

    const result = await apiLogout(at);

    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    clearTokens();

    if (result.isErr()) {
      setError(errorMessage(result.error));
    }

    setIsLoading(false);
  }

  async function refresh() {
    const rt = refreshToken();
    if (!rt) return;

    setIsLoading(true);
    setError(null);

    const result = await apiRefreshToken({ refreshToken: rt } as never);
    if (result.isErr()) {
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
      clearTokens();
      setError(errorMessage(result.error));
      setIsLoading(false);
      return;
    }

    const { accessToken: at } = result.value;
    localStorage.setItem(ACCESS_TOKEN_KEY, at);
    setAccessToken(at);
    setIsLoading(false);
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
    logout,
    refresh,
  };
}
