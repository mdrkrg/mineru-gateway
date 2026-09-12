import { Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { t } from '@/i18n';
import { useAuth } from '@/stores/auth-context';
import { ROUTES } from '@/utils/constants';

export const Route = createFileRoute('/oauth/callback')({
  component: OAuthCallbackPage,
});

/**
 * Landing page for two gateway redirect flows:
 *
 * 1. OAuth: the backend completes the OIDC code exchange and 302-redirects
 *    here with tokens in the URL fragment:
 *    `#access_token=...&refresh_token=...&token_type=bearer`.
 * 2. Email verification: clicking the link in the verification email makes
 *    the backend verify the token and 302-redirect here with the outcome in
 *    the fragment: `#verified=true` or `#verified=false`.
 */
function OAuthCallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = createSignal<string | null>(null);
  const [verifyState, setVerifyState] = createSignal<'success' | 'failed' | null>(null);

  onMount(async () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    // The tokens / verification outcome are now captured in `params`. Drop the
    // fragment from the current history entry so they do not linger in the
    // URL bar or browser history.
    if (window.location.hash) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
    const verified = params.get('verified');
    if (verified === 'true' || verified === 'false') {
      setVerifyState(verified === 'true' ? 'success' : 'failed');
      if (verified === 'true' && auth.isAuthenticated()) {
        await auth.refreshUser();
        if (auth.isAuthenticated()) {
          navigate({ to: ROUTES.home });
        }
      }
      return;
    }

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !refreshToken) {
      setError(t('oauth.errMissingTokens'));
      return;
    }

    await auth.loginWithTokens(accessToken, refreshToken);
    if (auth.isAuthenticated()) {
      navigate({ to: ROUTES.home });
    } else {
      setError(auth.error() ?? t('oauth.errLoginFailed'));
    }
  });

  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div class="w-full max-w-sm bg-white rounded-lg shadow p-8 text-center">
        <Show
          when={verifyState() === 'success'}
          fallback={
            <Show
              when={verifyState() === 'failed'}
              fallback={
                <Show
                  when={error()}
                  fallback={<p class="text-gray-600">{t('oauth.completing')}</p>}
                >
                  <h1 class="text-xl font-bold mb-2">{t('oauth.failedTitle')}</h1>
                  <p class="text-sm text-red-600 mb-4">{error()}</p>
                  <Link to={ROUTES.login} class="text-blue-600 hover:underline">
                    {t('oauth.backToLogin')}
                  </Link>
                </Show>
              }
            >
              <h1 class="text-xl font-bold mb-2">{t('oauth.verifyFailedTitle')}</h1>
              <p class="text-sm text-red-600 mb-4">
                {t('oauth.verifyFailedBody')}
              </p>
              <Link to={ROUTES.login} class="text-blue-600 hover:underline">
                {t('oauth.backToLogin')}
              </Link>
            </Show>
          }
        >
          <h1 class="text-xl font-bold mb-2">{t('oauth.verifySuccessTitle')}</h1>
          <p class="text-sm text-gray-600 mb-4">
            {t('oauth.verifySuccessBody')}
          </p>
          <Show
            when={auth.isAuthenticated()}
            fallback={
              <Link to={ROUTES.login} class="text-blue-600 hover:underline">
                {t('oauth.goLogin')}
              </Link>
            }
          >
            <Link to={ROUTES.home} class="text-blue-600 hover:underline">
              {t('oauth.goHome')}
            </Link>
          </Show>
        </Show>
      </div>
    </div>
  );
}
