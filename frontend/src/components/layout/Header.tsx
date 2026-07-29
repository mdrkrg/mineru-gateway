import { Show } from 'solid-js';
import { useLocation, useNavigate } from '@tanstack/solid-router';
import { LogOut } from 'lucide-solid';
import { useAuth } from '@/stores/auth-context';
import { ROUTES } from '@/utils/constants';

/** Exact and prefix path → page title mappings for the header breadcrumb. */
const EXACT_TITLES: Record<string, string> = {
  [ROUTES.home]: '仪表盘',
  [ROUTES.tasks]: '任务',
  [ROUTES.upload]: '上传解析',
  [ROUTES.download]: '结果下载',
  [ROUTES.apiKeys]: 'API Keys',
  [ROUTES.profile]: '个人资料',
  [ROUTES.adminKeys]: 'Key 管理',
  [ROUTES.adminUsers]: '用户管理',
};

const PREFIX_TITLES: [string, string][] = [
  [`${ROUTES.tasks}/`, '任务详情'],
];

function pageTitle(pathname: string): string {
  const exact = EXACT_TITLES[pathname];
  if (exact) return exact;
  for (const [prefix, title] of PREFIX_TITLES) {
    if (pathname.startsWith(prefix)) return title;
  }
  return '';
}

export default function Header() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const title = () => pageTitle(location().pathname);
  const displayName = () => auth.user()?.displayName || auth.user()?.email || '';

  async function handleLogout() {
    await auth.logout();
    navigate({ to: ROUTES.login });
  }

  return (
    <header class="h-14 shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <h1 class="text-lg font-semibold text-gray-800">{title()}</h1>

      <div class="flex items-center gap-4">
        <Show when={auth.user()}>
          <span class="text-sm text-gray-600">{displayName()}</span>
        </Show>
        <button
          type="button"
          onClick={handleLogout}
          disabled={auth.isLoading()}
          class="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <LogOut class="w-4 h-4" />
          退出登录
        </button>
      </div>
    </header>
  );
}
