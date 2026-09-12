import { createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { ToastStore } from '@/stores/toast';

const ToastCtx = createContext<ToastStore>();

/**
 * Access the toast store from any component within the {@link ToastProvider}
 * tree.
 *
 * @throws If called outside a {@link ToastProvider}.
 */
export function useToast(): ToastStore {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

/**
 * Provides the toast store to the SolidJS component tree. The store is
 * created externally (in the entry point) and passed in.
 */
export function ToastProvider(props: { store: ToastStore; children: JSX.Element }) {
  return <ToastCtx.Provider value={props.store}>{props.children}</ToastCtx.Provider>;
}
