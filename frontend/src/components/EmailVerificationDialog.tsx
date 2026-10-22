import * as stylex from '@stylexjs/stylex';
import { Show, createEffect, createSignal } from 'solid-js';
import { MailCheck, RefreshCw, X } from 'lucide-solid';
import { requestVerifyToken } from '@/api/functions/auth';
import { t } from '@/i18n';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';
import { controls } from '@/styles/controls.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { modal } from '@/styles/modal.stylex';
import { typography } from '@/styles/typography.stylex';
import { space } from '@/styles/tokens.stylex';

const styles = stylex.create({
  send: {
    gap: space.px8,
  },
  check: {
    gap: space.px8,
    fontWeight: 400,
  },
});

/**
 * Email verification pop-up shown after login / register / session restore
 * while the current user's email is unverified (`is_verified=false`).
 *
 * Offers two actions:
 * - "send verification email" (`emailVerification.send`) - resend the
 *   verification email via `POST /auth/request-verify-token` (the address
 *   is the logged-in user's email; the gateway auto-sends on register as
 *   well).
 * - "I have verified — refresh status" (`emailVerification.check`) -
 *   refetch the profile via {@link useAuth} `refreshUser`; closes once the
 *   backend reports `is_verified=true`.
 *
 * Dismissible; reappears on the next login / page load while unverified.
 */
export default function EmailVerificationDialog() {
  const auth = useAuth();

  const [open, setOpen] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const user = auth.user();
    if (user && !user.isVerified) {
      setOpen(true);
    } else if (!user || user.isVerified) {
      // Verified elsewhere (e.g. email link in another tab) or logged out.
      setOpen(false);
    }
  });

  async function handleSend() {
    const user = auth.user();
    if (!user) return;

    setSending(true);
    setError(null);
    const result = await requestVerifyToken({ email: user.email });
    setSending(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }
    setSent(true);
  }

  async function handleCheckVerified() {
    setChecking(true);
    setError(null);
    await auth.refreshUser();
    setChecking(false);

    if (auth.user()?.isVerified) {
      setSent(false);
      setOpen(false);
      return;
    }
    setError(t('emailVerification.errNotVerified'));
  }

  return (
    <Show when={open()}>
      <div {...stylex.attrs(modal.overlay, modal.overlayCentered)}>
        <div {...stylex.attrs(modal.dialog, modal.dialogWide)}>
          <div {...stylex.attrs(modal.header)}>
            <h2 {...stylex.attrs(typography.sectionHeading)}>{t('emailVerification.title')}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              {...stylex.attrs(controls.iconButton)}
            >
              <X class={stylex.attrs(icons.md).class} />
            </button>
          </div>

          <p {...stylex.attrs(typography.bodySecondary, layout.mb16)}>{t('emailVerification.body')}</p>

          <Show when={sent()}>
            <p {...stylex.attrs(controls.alertSuccess, layout.mb16)}>
              {t('emailVerification.sent')}
            </p>
          </Show>
          <Show when={error()}>
            <p {...stylex.attrs(controls.alertError, layout.mb16)}>{error()}</p>
          </Show>

          <div {...stylex.attrs(layout.stack8)}>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending()}
              {...stylex.attrs(
                controls.button,
                controls.buttonPrimary,
                controls.buttonLarge,
                styles.send,
              )}
            >
              <MailCheck class={stylex.attrs(icons.sm).class} />
              {sending()
                ? t('emailVerification.sending')
                : sent()
                  ? t('emailVerification.resend')
                  : t('emailVerification.send')}
            </button>
            <button
              type="button"
              onClick={handleCheckVerified}
              disabled={checking()}
              {...stylex.attrs(controls.button, controls.buttonOutline, styles.check)}
            >
              <RefreshCw class={stylex.attrs(icons.sm).class} />
              {checking() ? t('emailVerification.checking') : t('emailVerification.check')}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
