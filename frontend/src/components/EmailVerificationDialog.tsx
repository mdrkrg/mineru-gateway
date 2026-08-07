import { Show, createEffect, createSignal } from 'solid-js';
import { MailCheck, RefreshCw, X } from 'lucide-solid';
import { requestVerifyToken } from '@/api/functions/auth';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';

/**
 * Email verification pop-up shown after login / register / session restore
 * while the current user's email is unverified (`is_verified=false`).
 *
 * Offers two actions:
 * - "发送验证邮件" - resend the verification email via
 *   `POST /auth/request-verify-token` (the address is the logged-in user's
 *   email; the gateway auto-sends on register as well).
 * - "我已验证，刷新状态" - refetch the profile via {@link useAuth}
 *   `refreshUser`; closes once the backend reports `is_verified=true`.
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
    setError('尚未完成验证，请点击邮件中的验证链接后重试');
  }

  return (
    <Show when={open()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div class="w-full max-w-md bg-white rounded-lg shadow-xl p-6">
          <div class="flex items-start justify-between mb-3">
            <h2 class="text-lg font-semibold">邮箱验证</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭"
              class="text-gray-400 hover:text-gray-600"
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          <p class="text-sm text-gray-600 mb-4">
            您的邮箱尚未验证。验证邮箱后才能创建 API Key。验证邮件已发送至您的邮箱，请查收并点击其中的验证链接；未收到时可点击下方按钮重新发送。
          </p>

          <Show when={sent()}>
            <p class="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2 mb-4">
              验证邮件已发送，请查收。
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
              {sending() ? '发送中…' : sent() ? '重新发送验证邮件' : '发送验证邮件'}
            </button>
            <button
              type="button"
              onClick={handleCheckVerified}
              disabled={checking()}
              class="flex items-center justify-center gap-2 border border-gray-300 rounded px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw class="w-4 h-4" />
              {checking() ? '检查中…' : '我已验证，刷新状态'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
