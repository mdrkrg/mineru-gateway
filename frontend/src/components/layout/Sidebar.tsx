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
import { useAuth } from '../../stores/auth-context';
import { ROUTES } from '../../utils/constants';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.home, label: '仪表盘', icon: LayoutDashboard },
  { to: ROUTES.tasks, label: '任务', icon: ListTodo },
  { to: ROUTES.upload, label: '上传解析', icon: Upload },
  { to: ROUTES.download, label: '结果下载', icon: Download },
  { to: ROUTES.apiKeys, label: 'API Keys', icon: KeyRound },
  { to: ROUTES.profile, label: '个人资料', icon: User },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: ROUTES.adminKeys, label: 'Key 管理', icon: ShieldCheck },
  { to: ROUTES.adminUsers, label: '用户管理', icon: Users },
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
      {props.item.label}
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
            管理
          </div>
          <For each={ADMIN_ITEMS}>{(item) => <NavLink item={item} />}</For>
        </Show>
      </nav>
    </aside>
  );
}
