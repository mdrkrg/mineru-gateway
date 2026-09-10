import { For, Show } from 'solid-js';
import { Link } from '@tanstack/solid-router';
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

function NavLink(props: { item: NavItem }) {
  return (
    <Link
      to={props.item.to}
      activeOptions={{ exact: props.item.to === ROUTES.home }}
      activeProps={{ class: 'bg-gray-700 text-white' }}
      inactiveProps={{ class: 'text-gray-300 hover:bg-gray-700 hover:text-white' }}
      class="flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors"
    >
      <props.item.icon class="w-4 h-4 shrink-0" />
      {t(props.item.labelKey)}
    </Link>
  );
}

export default function Sidebar() {
  const auth = useAuth();
  const isAdmin = () => auth.user()?.isSuperuser === true;

  return (
    <aside class="w-56 shrink-0 bg-gray-800 flex flex-col">
      <div class="px-4 py-4 border-b border-gray-700">
        <span class="text-white font-bold">MinerU Gateway</span>
      </div>

      <nav class="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
        <For each={NAV_ITEMS}>{(item) => <NavLink item={item} />}</For>

        <Show when={isAdmin()}>
          <div class="mt-4 px-3 pb-1 text-xs font-semibold text-gray-400 uppercase">
            {t('nav.admin')}
          </div>
          <For each={ADMIN_ITEMS}>{(item) => <NavLink item={item} />}</For>
        </Show>
      </nav>
    </aside>
  );
}
