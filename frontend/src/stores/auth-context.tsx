import { createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { AuthStore } from '@/stores/auth';

const AuthCtx = createContext<AuthStore>();

/**
 * Access the auth store from any component within the {@link AuthProvider} tree.
 *
 * @throws If called outside an {@link AuthProvider}.
 */
export function useAuth(): AuthStore {
  const ctx = useContext(AuthCtx);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

/**
 * Provides the auth store to the SolidJS component tree via context.
 *
 * Must wrap the root app component (typically around {@link RouterProvider}).
 * The store itself is created externally (in the entry point) and passed in
 * so the router can reference the same instance for {@link requireAuth} guards.
 */
export function AuthProvider(props: { store: AuthStore; children: JSX.Element }) {
  return (
    <AuthCtx.Provider value={props.store}>
      {props.children}
    </AuthCtx.Provider>
  );
}
