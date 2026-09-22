import * as stylex from '@stylexjs/stylex';
import { For, Show } from 'solid-js';
import { Link, useMatchRoute } from '@tanstack/solid-router';
import {
  Download,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  ShieldCheck,
  Upload,
  User,
  Users,
} from 'lucide-solid';
import { useAuth } from '@/stores/auth-context';
import { t, type DictKey } from '@/i18n';
import { ROUTES } from '@/utils/constants';
import {
  colors,
  fontSize,
  lineHeight,
  radius,
  space,
} from '@/styles/tokens.stylex';

interface NavItem {
  to: string;
  labelKey: DictKey;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.home, labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: ROUTES.tasks, labelKey: 'nav.tasks', icon: ListTodo },
  { to: ROUTES.upload, labelKey: 'nav.upload', icon: Upload },
  { to: ROUTES.download, labelKey: 'nav.download', icon: Download },
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
    paddingInline: space.px16,
    paddingBlock: space.px16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.gray700,
  },
  brandText: {
    color: colors.white,
    fontWeight: 700,
  },
  nav: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
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
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    fontWeight: 600,
    color: colors.gray400,
    textTransform: 'uppercase',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px12,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px8,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    fontWeight: 500,
    textDecorationLine: 'none',
    transitionProperty:
      'color, background-color, border-color, text-decoration-color, fill, stroke',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    transitionDuration: '150ms',
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
  icon: {
    width: space.px16,
    height: space.px16,
    flexShrink: 0,
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
          styles.link,
          isActive() ? styles.linkActive : styles.linkInactive,
        ).class
      }
    >
      <props.item.icon class={stylex.attrs(styles.icon).class} />
      {t(props.item.labelKey)}
    </Link>
  );
}

export default function Sidebar() {
  const auth = useAuth();
  const isAdmin = () => auth.user()?.isSuperuser === true;

  return (
    <aside {...stylex.attrs(styles.sidebar)}>
      <div {...stylex.attrs(styles.brand)}>
        <span {...stylex.attrs(styles.brandText)}>MinerU Gateway</span>
      </div>

      <nav {...stylex.attrs(styles.nav)}>
        <For each={NAV_ITEMS}>{(item) => <NavLink item={item} />}</For>

        <Show when={isAdmin()}>
          <div {...stylex.attrs(styles.adminLabel)}>{t('nav.admin')}</div>
          <For each={ADMIN_ITEMS}>{(item) => <NavLink item={item} />}</For>
        </Show>
      </nav>
    </aside>
  );
}
