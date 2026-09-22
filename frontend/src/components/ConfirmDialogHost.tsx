import * as stylex from '@stylexjs/stylex';
import { Show } from 'solid-js';
import { AlertDialog } from '@kobalte/core/alert-dialog';
import { t } from '@/i18n';
import { useConfirm } from '@/stores/confirm-context';
import { controls } from '@/styles/controls.stylex';
import {
  colors,
  fontSize,
  lineHeight,
  maxWidth,
  radius,
  shadow,
  space,
} from '@/styles/tokens.stylex';

const styles = stylex.create({
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    backgroundColor: 'rgb(0 0 0 / 40%)',
  },
  content: {
    position: 'fixed',
    left: '50%',
    top: '50%',
    translate: '-50% -50%',
    zIndex: 50,
    width: '100%',
    maxWidth: maxWidth.px384,
    borderRadius: radius.px8,
    backgroundColor: colors.white,
    padding: space.px24,
    boxShadow: shadow.xl,
  },
  title: {
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
    color: colors.gray900,
  },
  description: {
    marginTop: space.px8,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray600,
  },
  actions: {
    marginTop: space.px24,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: space.px12,
  },
  cancel: {
    fontWeight: 400,
  },
});

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
            <AlertDialog.Overlay class={stylex.attrs(styles.overlay).class} />
            <AlertDialog.Content class={stylex.attrs(styles.content).class}>
              <AlertDialog.Title class={stylex.attrs(styles.title).class}>
                {req().title}
              </AlertDialog.Title>
              <AlertDialog.Description class={stylex.attrs(styles.description).class}>
                {req().description ?? ''}
              </AlertDialog.Description>
              <div {...stylex.attrs(styles.actions)}>
                <button
                  type="button"
                  onClick={() => confirm.resolve(false)}
                  {...stylex.attrs(controls.button, controls.buttonOutline, styles.cancel)}
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
