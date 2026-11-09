import * as stylex from '@stylexjs/stylex';
import { For, Show } from 'solid-js';
import { Link, useMatchRoute } from '@tanstack/solid-router';
import {
  KeyRound,
  LayoutDashboard,
  ListTodo,
  ShieldCheck,
  Upload,
  User,
  Users,
} from 'lucide-solid';
import { useAuth } from '@/stores/auth-context';
import { useConfig } from '@/stores/config-context';
import { t, type DictKey } from '@/i18n';
import { ROUTES } from '@/utils/constants';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { colors, radius, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

interface NavItem {
  to: string;
  labelKey: DictKey;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.home, labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: ROUTES.tasks, labelKey: 'nav.tasks', icon: ListTodo },
  { to: ROUTES.upload, labelKey: 'nav.upload', icon: Upload },
  { to: ROUTES.apiKeys, labelKey: 'nav.apiKeys', icon: KeyRound },
  { to: ROUTES.profile, labelKey: 'nav.profile', icon: User },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: ROUTES.adminKeys, labelKey: 'nav.adminKeys', icon: ShieldCheck },
  { to: ROUTES.adminUsers, labelKey: 'nav.adminUsers', icon: Users },
];

const styles = stylex.create({
  sidebar: {
    width: space.px224,
    flexShrink: 0,
    backgroundColor: colors.gray800,
    display: 'flex',
    flexDirection: 'column',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    paddingInline: space.px16,
    paddingBlock: space.px16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.gray700,
  },
  brandLink: {
    textDecorationLine: 'none',
  },
  brandText: {
    color: colors.white,
    fontWeight: 700,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px4,
    padding: space.px8,
    overflowY: 'auto',
  },
  adminLabel: {
    marginTop: space.px16,
    paddingInline: space.px12,
    paddingBottom: space.px4,
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px12,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px8,
    fontWeight: 500,
    textDecorationLine: 'none',
  },
  linkActive: {
    backgroundColor: colors.gray700,
    color: colors.white,
  },
  linkInactive: {
    color: colors.gray300,
    ':hover': {
      backgroundColor: colors.gray700,
      color: colors.white,
    },
  },
});

function NavLink(props: { item: NavItem }) {
  const matchRoute = useMatchRoute();
  const isActive = matchRoute({
    to: props.item.to,
    fuzzy: props.item.to !== ROUTES.home,
  });

  return (
    <Link
      to={props.item.to}
      class={
        stylex.attrs(
          typography.body,
          layout.transitionColors,
          styles.link,
          isActive() ? styles.linkActive : styles.linkInactive,
        ).class
      }
    >
      <props.item.icon class={stylex.attrs(icons.sm, layout.noShrink).class} />
      {t(props.item.labelKey)}
    </Link>
  );
}

export function SidebarNav(props: { onNavigate?: () => void; fill?: boolean }) {
  const auth = useAuth();
  const config = useConfig();
  const isAdmin = () => auth.user()?.isSuperuser === true;
  const showAdmin = () =>
    config.userAuthEnabled() ? isAdmin() : auth.apiKey() !== null;
  // A pasted API key has no user: self-service keys and the profile page
  // belong to the login stack and would only fail there.
  const navItems = () =>
    auth.user()
      ? NAV_ITEMS
      : NAV_ITEMS.filter(
          (item) => item.to !== ROUTES.apiKeys && item.to !== ROUTES.profile,
        );

  return (
    <nav
      onClick={() => props.onNavigate?.()}
      {...stylex.attrs(styles.nav, props.fill && layout.flex1)}
    >
      <For each={navItems()}>{(item) => <NavLink item={item} />}</For>

      <Show when={showAdmin()}>
        <div {...stylex.attrs(typography.metaFaint, styles.adminLabel)}>
          {t('nav.admin')}
        </div>
        <For each={ADMIN_ITEMS}>{(item) => <NavLink item={item} />}</For>
      </Show>
    </nav>
  );
}

export default function Sidebar() {
  return (
    <aside id="app-sidebar" {...stylex.attrs(styles.sidebar)}>
      <div {...stylex.attrs(styles.brand)}>
        <Link to={ROUTES.home} class={stylex.attrs(styles.brandLink).class}>
          <span {...stylex.attrs(styles.brandText)}>MinerU Gateway</span>
        </Link>
      </div>
      <SidebarNav fill />
    </aside>
  );
}
