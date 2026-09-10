import { Show, createEffect, createSignal } from 'solid-js';
import { MailCheck, RefreshCw, X } from 'lucide-solid';
import { requestVerifyToken } from '@/api/functions/auth';
import { t } from '@/i18n';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';

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
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div class="w-full max-w-md bg-white rounded-lg shadow-xl p-6">
          <div class="flex items-start justify-between mb-3">
            <h2 class="text-lg font-semibold">{t('emailVerification.title')}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              class="text-gray-400 hover:text-gray-600"
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          <p class="text-sm text-gray-600 mb-4">
            {t('emailVerification.body')}
          </p>

          <Show when={sent()}>
            <p class="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2 mb-4">
              {t('emailVerification.sent')}
            </p>
          </Show>
          <Show when={error()}>
            <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
              {error()}
            </p>
          </Show>

          <div class="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSend}
              disabled={sending()}
              class="flex items-center justify-center gap-2 bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <MailCheck class="w-4 h-4" />
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
              class="flex items-center justify-center gap-2 border border-gray-300 rounded px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw class="w-4 h-4" />
              {checking() ? t('emailVerification.checking') : t('emailVerification.check')}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
