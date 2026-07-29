import { Show, createSignal, onMount, For } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { useAuth } from '@/stores/auth-context';
import { getOAuthProviders } from '@/api/functions/auth';
import { ROUTES } from '@/utils/constants';
import { env } from '@/env';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function buildOAuthRedirectUrl(provider: string): string {
  const path = `/auth/oauth/${provider}/authorize`;
  const base = env.apiPrefix.replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [providers, setProviders] = createSignal<{ name: string }[]>([]);

  onMount(async () => {
    const result = await getOAuthProviders();
    if (result.isOk()) {
      setProviders(result.value.providers);
    }
  });

  function handleOAuthLogin(provider: string) {
    window.location.assign(buildOAuthRedirectUrl(provider));
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    await auth.login(email(), password());
    if (auth.isAuthenticated()) {
      navigate({ to: ROUTES.home });
    }
  }

  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div class="w-full max-w-sm bg-white rounded-lg shadow p-8">
        <h1 class="text-2xl font-bold text-center mb-2">登录</h1>
        <p class="text-sm text-gray-500 text-center mb-6">MinerU Gateway</p>

        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">邮箱</span>
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
            <span class="text-sm font-medium text-gray-700">密码</span>
            <input
              type="password"
              required
              autocomplete="current-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <Show when={auth.error()}>
            <p class="text-sm text-red-600">{auth.error()}</p>
          </Show>

          <button
            type="submit"
            disabled={auth.isLoading()}
            class="bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {auth.isLoading() ? '登录中…' : '登录'}
          </button>
        </form>

        <Show when={providers().length > 0}>
          <div class="mt-4">
            <div class="flex items-center gap-2 mb-3">
              <div class="flex-1 border-t border-gray-200" />
              <span class="text-xs text-gray-400">第三方登录</span>
              <div class="flex-1 border-t border-gray-200" />
            </div>
            <div class="flex flex-col gap-2">
              <For each={providers()}>
                {(p) => (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin(p.name)}
                    class="w-full border border-gray-300 rounded px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {p.name} 登录
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <p class="text-sm text-gray-500 text-center mt-4">
          还没有账号?{' '}
          <Link to={ROUTES.register} class="text-blue-600 hover:underline">
            注册
          </Link>
        </p>
      </div>
    </div>
  );
}
