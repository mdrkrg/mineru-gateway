import { createSignal } from 'solid-js';

/** Options for a confirmation prompt. */
export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Confirm button label. Defaults to `确定`. */
  confirmText?: string;
  /** Cancel button label. Defaults to `取消`. */
  cancelText?: string;
  /** `danger` renders a destructive confirm button. Defaults to `default`. */
  variant?: 'danger' | 'default';
}

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (confirmed: boolean) => void;
}

/**
 * Imperative confirmation dialogs, replacing `window.confirm`.
 *
 * `ask()` returns a promise that resolves to the user's choice, so call sites
 * read like the native API while getting a themed, accessible dialog.
 */
export interface ConfirmStore {
  /** The pending request, or `null` when no dialog is open. */
  request: () => ConfirmRequest | null;
  /** Show a dialog and resolve `true` on confirm, `false` on cancel. */
  ask: (options: ConfirmOptions) => Promise<boolean>;
  /** Settle the pending dialog; no-op when none is open. */
  resolve: (confirmed: boolean) => void;
}

export function createConfirmStore(): ConfirmStore {
  const [request, setRequest] = createSignal<ConfirmRequest | null>(null);
  let nextId = 1;

  function resolve(confirmed: boolean) {
    const current = request();
    if (!current) return;
    setRequest(null);
    current.resolve(confirmed);
  }

  function ask(options: ConfirmOptions): Promise<boolean> {
    // A new prompt supersedes any pending one (treat it as cancelled).
    request()?.resolve(false);
    return new Promise<boolean>((resolvePromise) => {
      setRequest({ ...options, id: nextId, resolve: resolvePromise });
      nextId += 1;
    });
  }

  return { request, ask, resolve };
}
