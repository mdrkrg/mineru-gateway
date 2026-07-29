import { Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { Upload } from 'lucide-solid';
import { getTaskStats } from '@/api/functions/tasks';
import type { TaskStatsResponse } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import { useApiKey } from '@/stores/api-key-context';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';
import { ROUTES, TASK_STATUS_LABELS } from '@/utils/constants';
import { formatFileSize, formatMilliseconds } from '@/utils/format';
import type { TaskStatus } from '@/api/schemas/tasks';

export const Route = createFileRoute('/_authenticated/')({
  component: DashboardPage,
});

interface StatCard {
  label: string;
  value: string;
  hint?: string;
}

function DashboardPage() {
  const auth = useAuth();
  const apiKeyStore = useApiKey();

  const [stats, setStats] = createSignal<TaskStatsResponse | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    const key = apiKeyStore.activeKey();
    if (!key) {
      setIsLoading(false);
      return;
    }
    const result = await getTaskStats(key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      setStats(result.value);
    }
    setIsLoading(false);
  });

  const statusCards = (): StatCard[] => {
    const s = stats();
    if (!s) return [];
    const byStatus: [TaskStatus, number][] = [
      ['pending', s.pending],
      ['processing', s.processing],
      ['retry_pending', s.retryPending],
      ['completed', s.completed],
      ['failed', s.failed],
      ['cancelled', s.cancelled],
    ];
    return byStatus.map(([status, count]) => ({
      label: TASK_STATUS_LABELS[status],
      value: String(count),
    }));
  };

  const overviewCards = (): StatCard[] => {
    const s = stats();
    if (!s) return [];
    return [
      { label: '今日完成', value: String(s.todayCompleted) },
      { label: '今日失败', value: String(s.todayFailed) },
      { label: '累计处理数据量', value: formatFileSize(s.totalBytes) },
      {
        label: '平均耗时',
        value: s.avgDurationMs !== null ? formatMilliseconds(s.avgDurationMs) : '—',
      },
    ];
  };

  return (
    <div class="max-w-5xl flex flex-col gap-6">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold">
          欢迎,{auth.user()?.displayName || auth.user()?.email}
        </h2>
        <Link
          to={ROUTES.upload}
          class="flex items-center gap-1.5 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          <Upload class="w-4 h-4" />
          上传解析
        </Link>
      </div>

      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        <Show when={!isLoading()} fallback={<p class="text-gray-500">加载中…</p>}>
          <Show when={error()}>
            <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error()}
            </p>
          </Show>

          <Show when={stats()}>
            <section>
              <h3 class="text-sm font-semibold text-gray-500 mb-2">任务状态</h3>
              <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {statusCards().map((card) => (
                  <div class="bg-white rounded-lg shadow p-4">
                      <p class="text-xs text-gray-500 mb-1">{card.label}</p>
                      <p class="text-2xl font-bold">{card.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 class="text-sm font-semibold text-gray-500 mb-2">概览</h3>
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {overviewCards().map((card) => (
                  <div class="bg-white rounded-lg shadow p-4">
                    <p class="text-xs text-gray-500 mb-1">{card.label}</p>
                    <p class="text-2xl font-bold">{card.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <p class="text-sm text-gray-500">
              查看<Link to={ROUTES.tasks} class="text-blue-600 hover:underline">任务列表</Link>
              了解每个任务的详情。
            </p>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
