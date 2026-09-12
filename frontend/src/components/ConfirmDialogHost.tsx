import { Show } from 'solid-js';
import { AlertDialog } from '@kobalte/core/alert-dialog';
import { useConfirm } from '@/stores/confirm-context';

/**
 * Renders the pending confirmation dialog, if any. Mounted once near the
 * router root so `useConfirm().ask()` works from any route.
 */
export default function ConfirmDialogHost() {
  const confirm = useConfirm();

  return (
    <Show when={confirm.request()}>
      {(req) => (
        <AlertDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) confirm.resolve(false);
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay class="fixed inset-0 z-50 bg-black/40" />
            <AlertDialog.Content class="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
              <AlertDialog.Title class="text-lg font-semibold text-gray-900">
                {req().title}
              </AlertDialog.Title>
              <AlertDialog.Description class="mt-2 text-sm text-gray-600">
                {req().description ?? ''}
              </AlertDialog.Description>
              <div class="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => confirm.resolve(false)}
                  class="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {req().cancelText ?? '取消'}
                </button>
                <button
                  type="button"
                  onClick={() => confirm.resolve(true)}
                  class={
                    req().variant === 'danger'
                      ? 'rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700'
                      : 'rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700'
                  }
                >
                  {req().confirmText ?? '确定'}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog>
      )}
    </Show>
  );
}
