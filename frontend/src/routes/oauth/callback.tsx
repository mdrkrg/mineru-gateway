import { Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { useAuth } from '@/stores/auth-context';
import { ROUTES } from '@/utils/constants';

export const Route = createFileRoute('/oauth/callback')({
  component: OAuthCallbackPage,
});

/**
 * Landing page for the gateway OAuth flow. The backend completes the OIDC
 * code exchange and 302-redirects here with tokens in the URL fragment:
 * `#access_token=...&refresh_token=...&token_type=bearer`.
 */
function OAuthCallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !refreshToken) {
      setError('登录回调缺少令牌参数,请重试');
      return;
    }

    await auth.loginWithTokens(accessToken, refreshToken);
    if (auth.isAuthenticated()) {
      navigate({ to: ROUTES.home });
    } else {
      setError(auth.error() ?? '登录失败,请重试');
    }
  });

  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div class="w-full max-w-sm bg-white rounded-lg shadow p-8 text-center">
        <Show
          when={error()}
          fallback={<p class="text-gray-600">正在完成登录…</p>}
        >
          <h1 class="text-xl font-bold mb-2">登录失败</h1>
          <p class="text-sm text-red-600 mb-4">{error()}</p>
          <Link to={ROUTES.login} class="text-blue-600 hover:underline">
            返回登录
          </Link>
        </Show>
      </div>
    </div>
  );
}
