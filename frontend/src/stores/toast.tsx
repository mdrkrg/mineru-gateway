import { createSignal } from 'solid-js';

/** Visual variants for transient toasts. */
export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

/**
 * Global, ephemeral user feedback shown in a corner overlay.
 *
 * Kept separate from page-level inline errors: toasts survive navigation so
 * an action's outcome is not missed when the list re-renders or the user
 * moves on.
 */
export interface ToastStore {
  /** Currently visible toasts, oldest first. */
  toasts: () => Toast[];
  /** Push a toast and schedule its auto-dismiss. Returns the toast id. */
  show: (message: string, variant?: ToastVariant) => number;
  /** Remove a toast immediately (manual or timer-driven). */
  dismiss: (id: number) => void;
}

/** Default auto-dismiss delay in milliseconds. */
export const TOAST_DISMISS_MS = 4000;

/**
 * Creates a toast store.
 *
 * @param dismissMs - Auto-dismiss delay; overridable in tests.
 */
export function createToastStore(dismissMs: number = TOAST_DISMISS_MS): ToastStore {
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextId = 1;

  function dismiss(id: number) {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }

  function show(message: string, variant: ToastVariant = 'info') {
    const id = nextId;
    nextId += 1;
    setToasts((list) => [...list, { id, variant, message }]);
    timers.set(
      id,
      setTimeout(() => dismiss(id), dismissMs),
    );
    return id;
  }

  return { toasts, show, dismiss };
}
