import { createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { AdminTokenStore } from '@/stores/admin-token';

const AdminTokenCtx = createContext<AdminTokenStore>();

/**
 * Access the admin-token store from any component within the
 * {@link AdminTokenProvider} tree.
 *
 * @throws If called outside an {@link AdminTokenProvider}.
 */
export function useAdminToken(): AdminTokenStore {
  const ctx = useContext(AdminTokenCtx);
  if (!ctx) {
    throw new Error('useAdminToken must be used within an AdminTokenProvider');
  }
  return ctx;
}

/**
 * Provides the admin-token store to the SolidJS component tree.
 */
export function AdminTokenProvider(props: {
  store: AdminTokenStore;
  children: JSX.Element;
}) {
  return (
    <AdminTokenCtx.Provider value={props.store}>
      {props.children}
    </AdminTokenCtx.Provider>
  );
}
