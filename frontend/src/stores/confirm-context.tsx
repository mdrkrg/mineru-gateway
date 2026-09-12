import { createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { ConfirmStore } from '@/stores/confirm';

const ConfirmCtx = createContext<ConfirmStore>();

/**
 * Access the confirmation-dialog store from any component within the
 * {@link ConfirmProvider} tree.
 *
 * @throws If called outside a {@link ConfirmProvider}.
 */
export function useConfirm(): ConfirmStore {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx;
}

/**
 * Provides the confirmation-dialog store to the SolidJS component tree. The
 * store is created externally (in the entry point) and passed in.
 */
export function ConfirmProvider(props: { store: ConfirmStore; children: JSX.Element }) {
  return <ConfirmCtx.Provider value={props.store}>{props.children}</ConfirmCtx.Provider>;
}
