import { createFileRoute } from '@tanstack/solid-router';
import { useAuth } from '../../stores/auth-context';

export const Route = createFileRoute('/_authenticated/')({
  component: DashboardPage,
});

function DashboardPage() {
  const auth = useAuth();

  return (
    <div>
      <h2 class="text-xl font-bold mb-2">
        欢迎,{auth.user()?.displayName || auth.user()?.email}
      </h2>
      <p class="text-gray-500">任务统计面板即将上线。</p>
    </div>
  );
}
