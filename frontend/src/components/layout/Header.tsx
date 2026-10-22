import * as stylex from '@stylexjs/stylex';
import { For, Show } from 'solid-js';
import { useLocation, useNavigate } from '@tanstack/solid-router';
import { LogOut } from 'lucide-solid';
import { LOCALES, locale, setLocale, t } from '@/i18n';
import type { DictKey, Locale } from '@/i18n';
import { useAuth } from '@/stores/auth-context';
import { ROUTES } from '@/utils/constants';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { colors, radius, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

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

const styles = stylex.create({
  header: {
    height: space.px56,
    flexShrink: 0,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.gray200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingInline: space.px24,
  },
  title: {
    color: colors.gray800,
  },
  locale: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.gray300,
    borderRadius: radius.px4,
    paddingInline: space.px8,
    paddingBlock: space.px4,
    backgroundColor: colors.white,
    color: colors.gray700,
  },
  logout: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px6,
    color: colors.gray600,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: 'pointer',
    ':hover': {
      color: colors.gray900,
    },
    opacity: {
      ':disabled': 0.5,
    },
  },
});

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
    <header {...stylex.attrs(styles.header)}>
      <h1 {...stylex.attrs(typography.sectionHeading, styles.title)}>{title()}</h1>

      <div {...stylex.attrs(layout.rowCenter16)}>
        <Show when={auth.user()}>
          <span {...stylex.attrs(typography.bodySecondary)}>{displayName()}</span>
        </Show>
        <select
          value={locale()}
          onChange={(e) => setLocale(e.currentTarget.value as Locale)}
          aria-label={t('nav.language')}
          {...stylex.attrs(typography.body, styles.locale)}
        >
          <For each={LOCALES}>
            {(code) => <option value={code}>{LOCALE_LABELS[code]}</option>}
          </For>
        </select>
        <button
          type="button"
          onClick={handleLogout}
          disabled={auth.isLoading()}
          {...stylex.attrs(typography.body, styles.logout)}
        >
          <LogOut class={stylex.attrs(icons.sm).class} />
          {t('nav.logout')}
        </button>
      </div>
    </header>
  );
}
