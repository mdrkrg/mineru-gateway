import * as stylex from '@stylexjs/stylex';
import { Show, createEffect, createSignal } from 'solid-js';
import { MailCheck, RefreshCw, X } from 'lucide-solid';
import { requestVerifyToken } from '@/api/functions/auth';
import { t } from '@/i18n';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgb(0 0 0 / 40%)',
    paddingInline: space.px16,
  },
  panel: {
    width: '100%',
    maxWidth: maxWidth.px448,
    backgroundColor: colors.white,
    borderRadius: radius.px8,
    boxShadow: shadow.xl,
    padding: space.px24,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: space.px12,
  },
  title: {
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
  },
  close: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    color: colors.gray400,
    ':hover': {
      color: colors.gray600,
    },
  },
  closeIcon: {
    width: space.px20,
    height: space.px20,
  },
  body: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray600,
    marginBottom: space.px16,
  },
  alertSpacing: {
    marginBottom: space.px16,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px8,
  },
  send: {
    gap: space.px8,
    fontSize: fontSize.px16,
    lineHeight: lineHeight.px24,
  },
  check: {
    gap: space.px8,
    fontWeight: 400,
  },
  icon: {
    width: space.px16,
    height: space.px16,
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
      <div {...stylex.attrs(styles.overlay)}>
        <div {...stylex.attrs(styles.panel)}>
          <div {...stylex.attrs(styles.header)}>
            <h2 {...stylex.attrs(styles.title)}>{t('emailVerification.title')}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              {...stylex.attrs(styles.close)}
            >
              <X class={stylex.attrs(styles.closeIcon).class} />
            </button>
          </div>

          <p {...stylex.attrs(styles.body)}>{t('emailVerification.body')}</p>

          <Show when={sent()}>
            <p {...stylex.attrs(controls.alertSuccess, styles.alertSpacing)}>
              {t('emailVerification.sent')}
            </p>
          </Show>
          <Show when={error()}>
            <p {...stylex.attrs(controls.alertError, styles.alertSpacing)}>{error()}</p>
          </Show>

          <div {...stylex.attrs(styles.actions)}>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending()}
              {...stylex.attrs(controls.button, controls.buttonPrimary, styles.send)}
            >
              <MailCheck class={stylex.attrs(styles.icon).class} />
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
              <RefreshCw class={stylex.attrs(styles.icon).class} />
              {checking() ? t('emailVerification.checking') : t('emailVerification.check')}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
