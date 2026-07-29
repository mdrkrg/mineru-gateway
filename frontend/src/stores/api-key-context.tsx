import { createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { ApiKeyStore } from '@/stores/api-key';

const ApiKeyCtx = createContext<ApiKeyStore>();

/**
 * Access the active-API-key store from any component within the
 * {@link ApiKeyProvider} tree.
 *
 * @throws If called outside an {@link ApiKeyProvider}.
 */
export function useApiKey(): ApiKeyStore {
  const ctx = useContext(ApiKeyCtx);
  if (!ctx) {
    throw new Error('useApiKey must be used within an ApiKeyProvider');
  }
  return ctx;
}

/**
 * Provides the active-API-key store to the SolidJS component tree.
 * The store is created externally (in the entry point) and passed in.
 */
export function ApiKeyProvider(props: { store: ApiKeyStore; children: JSX.Element }) {
  return (
    <ApiKeyCtx.Provider value={props.store}>
      {props.children}
    </ApiKeyCtx.Provider>
  );
}
