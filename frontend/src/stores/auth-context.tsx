import { createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { AuthStore } from './auth';

const AuthCtx = createContext<AuthStore>();

export function useAuth(): AuthStore {
  const ctx = useContext(AuthCtx);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function AuthProvider(props: { store: AuthStore; children: JSX.Element }) {
  return (
    <AuthCtx.Provider value={props.store}>
      {props.children}
    </AuthCtx.Provider>
  );
}
