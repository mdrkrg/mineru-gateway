import * as stylex from '@stylexjs/stylex';
import { Show } from 'solid-js';
import { AlertDialog } from '@kobalte/core/alert-dialog';
import { t } from '@/i18n';
import { useConfirm } from '@/stores/confirm-context';
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { layout } from '@/styles/layout.stylex';
import { modal } from '@/styles/modal.stylex';
import { typography } from '@/styles/typography.stylex';

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
            <AlertDialog.Overlay class={stylex.attrs(modal.overlay).class} />
            <AlertDialog.Content
              class={stylex.attrs(modal.dialog, modal.dialogFixed).class}
            >
              <AlertDialog.Title class={stylex.attrs(modal.titleStrong).class}>
                {req().title}
              </AlertDialog.Title>
              <AlertDialog.Description
                class={stylex.attrs(typography.bodySecondary, layout.mt8).class}
              >
                {req().description ?? ''}
              </AlertDialog.Description>
              <div {...stylex.attrs(modal.actions)}>
                <button
                  type="button"
                  onClick={() => confirm.resolve(false)}
                  {...stylex.attrs(controls.button, controls.buttonOutline, actions.weightNormal)}
                >
                  {req().cancelText ?? t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => confirm.resolve(true)}
                  {...stylex.attrs(
                    controls.button,
                    req().variant === 'danger'
                      ? controls.buttonDanger
                      : controls.buttonPrimary,
                  )}
                >
                  {req().confirmText ?? t('common.confirm')}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog>
      )}
    </Show>
  );
}
