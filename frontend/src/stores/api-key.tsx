import { createSignal } from 'solid-js';

const ACTIVE_API_KEY = 'gateway_active_api_key';

/**
 * Holds the API key used for task endpoints (`X-API-Key`).
 *
 * The gateway's task APIs authenticate per API key, not per user JWT, so
 * the SPA needs a client-side "active key". The full key is only visible
 * once at creation time; users opt in to keeping it in this browser
 * (localStorage) or paste an existing key manually.
 *
 * TODO: Migrate to BFF-held credentials together with the auth tokens.
 */
export interface ApiKeyStore {
  activeKey: () => string | null;
  setActiveKey: (key: string) => void;
  clearActiveKey: () => void;
}

export function createApiKeyStore(): ApiKeyStore {
  const [activeKey, setActiveKeySignal] = createSignal<string | null>(
    localStorage.getItem(ACTIVE_API_KEY),
  );

  function setActiveKey(key: string) {
    localStorage.setItem(ACTIVE_API_KEY, key);
    setActiveKeySignal(key);
  }

  function clearActiveKey() {
    localStorage.removeItem(ACTIVE_API_KEY);
    setActiveKeySignal(null);
  }

  return { activeKey, setActiveKey, clearActiveKey };
}
