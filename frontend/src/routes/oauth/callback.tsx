import { Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
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
          when={verifyState() === 'success'}
          fallback={
            <Show
              when={verifyState() === 'failed'}
              fallback={
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
              }
            >
              <h1 class="text-xl font-bold mb-2">邮箱验证失败</h1>
              <p class="text-sm text-red-600 mb-4">
                验证链接无效或已过期，请重新申请验证邮件。
              </p>
              <Link to={ROUTES.login} class="text-blue-600 hover:underline">
                返回登录
              </Link>
            </Show>
          }
        >
          <h1 class="text-xl font-bold mb-2">邮箱验证成功</h1>
          <p class="text-sm text-gray-600 mb-4">
            您的邮箱已通过验证，现在可以创建 API Key。
          </p>
          <Show
            when={auth.isAuthenticated()}
            fallback={
              <Link to={ROUTES.login} class="text-blue-600 hover:underline">
                去登录
              </Link>
            }
          >
            <Link to={ROUTES.home} class="text-blue-600 hover:underline">
              返回首页
            </Link>
          </Show>
        </Show>
      </div>
    </div>
  );
}
