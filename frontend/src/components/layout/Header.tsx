import { For, Show } from 'solid-js';
import { useLocation, useNavigate } from '@tanstack/solid-router';
import { LogOut } from 'lucide-solid';
import { LOCALES, locale, setLocale, t } from '@/i18n';
import type { DictKey, Locale } from '@/i18n';
import { useAuth } from '@/stores/auth-context';
import { ROUTES } from '@/utils/constants';

/** Switcher entries use native names — each locale shows its own name. */
const LOCALE_LABELS: Record<Locale, string> = { en: 'English', 'zh-CN': '简体中文' };

/** Exact and prefix path → page title key mappings for the header breadcrumb. */
const EXACT_TITLES: Record<string, DictKey> = {
  [ROUTES.home]: 'nav.dashboard',
  [ROUTES.tasks]: 'nav.tasks',
  [ROUTES.upload]: 'nav.upload',
  [ROUTES.download]: 'nav.download',
  [ROUTES.apiKeys]: 'nav.apiKeys',
  [ROUTES.profile]: 'nav.profile',
  [ROUTES.adminKeys]: 'nav.adminKeys',
  [ROUTES.adminUsers]: 'nav.adminUsers',
};

const PREFIX_TITLES: [string, DictKey][] = [
  [`${ROUTES.tasks}/`, 'nav.taskDetail'],
];

function pageTitle(pathname: string): string {
  const exact = EXACT_TITLES[pathname];
  if (exact) return t(exact);
  for (const [prefix, key] of PREFIX_TITLES) {
    if (pathname.startsWith(prefix)) return t(key);
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
        <select
          value={locale()}
          onChange={(e) => setLocale(e.currentTarget.value as Locale)}
          aria-label={t('nav.language')}
          class="text-sm border border-gray-300 rounded px-2 py-1 bg-white text-gray-700"
        >
          <For each={LOCALES}>
            {(code) => <option value={code}>{LOCALE_LABELS[code]}</option>}
          </For>
        </select>
        <button
          type="button"
          onClick={handleLogout}
          disabled={auth.isLoading()}
          class="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <LogOut class="w-4 h-4" />
          {t('nav.logout')}
        </button>
      </div>
    </header>
  );
}
