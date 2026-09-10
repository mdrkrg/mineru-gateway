import { Show, createSignal } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { t } from '@/i18n';
import { register } from '@/api/functions/auth';
import { errorMessage } from '@/utils/api-error';
import { ROUTES } from '@/utils/constants';

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [confirm, setConfirm] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = createSignal<string | null>(null);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);

    if (password() !== confirm()) {
      setError(t('register.errPasswordMismatch'));
      return;
    }

    setIsSubmitting(true);
    const result = await register({
      email: email(),
      password: password(),
      isActive: null,
      isSuperuser: null,
      isVerified: null,
      displayName: displayName().trim() || null,
    });
    setIsSubmitting(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }

    setRegisteredEmail(email());
  }

  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div class="w-full max-w-sm bg-white rounded-lg shadow p-8">
        <Show
          when={registeredEmail()}
          fallback={
            <>
              <h1 class="text-2xl font-bold text-center mb-2">{t('register.title')}</h1>
              <p class="text-sm text-gray-500 text-center mb-6">MinerU Gateway</p>

              <form onSubmit={handleSubmit} class="flex flex-col gap-4">
                <label class="flex flex-col gap-1">
                  <span class="text-sm font-medium text-gray-700">{t('register.email')}</span>
                  <input
                    type="email"
                    required
                    autocomplete="email"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                    class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label class="flex flex-col gap-1">
                  <span class="text-sm font-medium text-gray-700">{t('register.displayName')}</span>
                  <input
                    type="text"
                    autocomplete="nickname"
                    value={displayName()}
                    onInput={(e) => setDisplayName(e.currentTarget.value)}
                    class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label class="flex flex-col gap-1">
                  <span class="text-sm font-medium text-gray-700">{t('register.password')}</span>
                  <input
                    type="password"
                    required
                    autocomplete="new-password"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label class="flex flex-col gap-1">
                  <span class="text-sm font-medium text-gray-700">{t('register.confirmPassword')}</span>
                  <input
                    type="password"
                    required
                    autocomplete="new-password"
                    value={confirm()}
                    onInput={(e) => setConfirm(e.currentTarget.value)}
                    class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <Show when={error()}>
                  <p class="text-sm text-red-600">{error()}</p>
                </Show>

                <button
                  type="submit"
                  disabled={isSubmitting()}
                  class="bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting() ? t('register.submitting') : t('register.submit')}
                </button>
              </form>

              <p class="text-sm text-gray-500 text-center mt-4">
                {t('register.hasAccount')}{' '}
                <Link to={ROUTES.login} class="text-blue-600 hover:underline">
                  {t('register.toLogin')}
                </Link>
              </p>
            </>
          }
        >
          {(email) => (
            <div class="text-center">
              <h1 class="text-2xl font-bold mb-2">{t('register.successTitle')}</h1>
              <p class="text-sm text-gray-600 mb-6">
                {t('register.successPrefix')}
                <span class="font-medium">{email()}</span>
                {t('register.successSuffix')}
              </p>
              <button
                type="button"
                onClick={() => navigate({ to: ROUTES.login })}
                class="bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700"
              >
                {t('register.goLogin')}
              </button>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
