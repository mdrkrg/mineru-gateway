import { createSignal } from 'solid-js';

const ADMIN_TOKEN_KEY = 'gateway_admin_token';

/**
 * Holds the gateway admin token (`X-Admin-Token`) for admin endpoints.
 *
 * The admin token is an operational secret distinct from the user's JWT;
 * it is kept in sessionStorage only (cleared when the tab closes).
 */
export interface AdminTokenStore {
  token: () => string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export function createAdminTokenStore(): AdminTokenStore {
  const [token, setTokenSignal] = createSignal<string | null>(
    sessionStorage.getItem(ADMIN_TOKEN_KEY),
  );

  function setToken(value: string) {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, value);
    setTokenSignal(value);
  }

  function clearToken() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setTokenSignal(null);
  }

  return { token, setToken, clearToken };
}
