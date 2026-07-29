import { For, Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { listTasks, cancelTask, batchCancelTasks } from '../../../api/functions/tasks';
import type { TaskListItem } from '../../../api/schemas/tasks';
import NoActiveKey from '../../../components/NoActiveKey';
import Pagination from '../../../components/Pagination';
import StatusBadge from '../../../components/StatusBadge';
import { useApiKey } from '../../../stores/api-key-context';
import { errorMessage } from '../../../utils/api-error';
import {
  ACTIVE_TASK_STATUSES,
  ROUTES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '../../../utils/constants';
import { formatDateTime } from '../../../utils/format';

export const Route = createFileRoute('/_authenticated/tasks/')({
  component: TaskListPage,
});

const PAGE_SIZE = 20;

const isActive = (status: string) =>
  (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);

function TaskListPage() {
  const apiKeyStore = useApiKey();

  const [items, setItems] = createSignal<TaskListItem[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [statusFilter, setStatusFilter] = createSignal('');
  const [fileNameFilter, setFileNameFilter] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [isActing, setIsActing] = createSignal(false);

  async function load(targetPage = page()) {
    const key = apiKeyStore.activeKey();
    if (!key) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);

    const result = await listTasks({
      apiKey: key,
      status: statusFilter() || undefined,
      fileName: fileNameFilter().trim() || undefined,
      page: targetPage,
      pageSize: PAGE_SIZE,
    });
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      setItems(result.value.items);
      setTotal(result.value.total);
      setPage(result.value.page);
      setSelected(new Set<string>());
    }
    setIsLoading(false);
  }

  onMount(() => load(1));

  function applyFilters(e: SubmitEvent) {
    e.preventDefault();
    load(1);
  }

  function toggleSelect(taskId: string, checked: boolean) {
    const next = new Set(selected());
    if (checked) next.add(taskId);
    else next.delete(taskId);
    setSelected(next);
  }

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelected(new Set<string>());
      return;
    }
    setSelected(new Set(items().filter((t) => isActive(t.status)).map((t) => t.taskId)));
  }

  async function handleCancel(task: TaskListItem) {
    const key = apiKeyStore.activeKey();
    if (!key) return;
    if (!window.confirm(`确定取消任务 ${task.taskId.slice(0, 8)}… 吗?`)) return;

    setIsActing(true);
    setError(null);
    const result = await cancelTask(task.taskId, key);
    if (result.isErr()) setError(errorMessage(result.error));
    await load();
    setIsActing(false);
  }

  async function handleBatchCancel() {
    const key = apiKeyStore.activeKey();
    if (!key) return;
    const ids = [...selected()];
    if (ids.length === 0) return;
    if (!window.confirm(`确定批量取消选中的 ${ids.length} 个任务吗?`)) return;

    setIsActing(true);
    setError(null);
    const result = await batchCancelTasks(ids, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else if (result.value.errors.length > 0) {
      setError(
        `已取消 ${result.value.cancelledCount} 个,${result.value.errors.length} 个失败`,
      );
    }
    await load();
    setIsActing(false);
  }

  const selectableCount = () => items().filter((t) => isActive(t.status)).length;

  return (
    <div class="flex flex-col gap-4">
      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        {/* Filters */}
        <form
          onSubmit={applyFilters}
          class="bg-white rounded-lg shadow p-4 flex flex-wrap items-end gap-3"
        >
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">状态</span>
            <select
              value={statusFilter()}
              onChange={(e) => setStatusFilter(e.currentTarget.value)}
              class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部</option>
              <For each={TASK_STATUSES}>
                {(s) => <option value={s}>{TASK_STATUS_LABELS[s]}</option>}
              </For>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">文件名</span>
            <input
              type="text"
              value={fileNameFilter()}
              onInput={(e) => setFileNameFilter(e.currentTarget.value)}
              placeholder="按文件名搜索"
              class="border border-gray-300 rounded px-3 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button
            type="submit"
            class="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            查询
          </button>
        </form>

        <Show when={error()}>
          <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error()}
          </p>
        </Show>

        {/* Batch actions */}
        <div class="flex items-center gap-3">
          <button
            type="button"
            disabled={selected().size === 0 || isActing()}
            onClick={handleBatchCancel}
            class="border border-red-300 text-red-600 rounded px-3 py-1.5 text-sm hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            批量取消({selected().size})
          </button>
          <button
            type="button"
            onClick={() => load()}
            class="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            刷新
          </button>
        </div>

        {/* Table */}
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <Show when={!isLoading()} fallback={<p class="p-6 text-gray-500">加载中…</p>}>
            <Show
              when={items().length > 0}
              fallback={<p class="p-6 text-gray-500">没有符合条件的任务。</p>}
            >
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-gray-500 border-b">
                    <th class="py-2 pl-4 pr-2 w-8">
                      <input
                        type="checkbox"
                        checked={selectableCount() > 0 && selected().size === selectableCount()}
                        onChange={(e) => toggleSelectAll(e.currentTarget.checked)}
                        disabled={selectableCount() === 0}
                      />
                    </th>
                    <th class="py-2 pr-4 font-medium">任务 ID</th>
                    <th class="py-2 pr-4 font-medium">状态</th>
                    <th class="py-2 pr-4 font-medium">后端</th>
                    <th class="py-2 pr-4 font-medium">文件</th>
                    <th class="py-2 pr-4 font-medium">创建时间</th>
                    <th class="py-2 pr-4 font-medium">重试</th>
                    <th class="py-2 pr-4 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={items()}>
                    {(task) => (
                      <tr class="border-b last:border-0 hover:bg-gray-50">
                        <td class="py-2 pl-4 pr-2">
                          <input
                            type="checkbox"
                            disabled={!isActive(task.status)}
                            checked={selected().has(task.taskId)}
                            onChange={(e) => toggleSelect(task.taskId, e.currentTarget.checked)}
                          />
                        </td>
                        <td class="py-2 pr-4">
                          <Link
                            to={ROUTES.taskDetail(task.taskId)}
                            class="text-blue-600 hover:underline"
                          >
                            <code class="text-xs">{task.taskId.slice(0, 8)}…</code>
                          </Link>
                        </td>
                        <td class="py-2 pr-4">
                          <StatusBadge status={task.status} />
                        </td>
                        <td class="py-2 pr-4 text-xs">{task.backend}</td>
                        <td class="py-2 pr-4 max-w-48 truncate" title={task.fileNames.join(', ')}>
                          {task.fileNames.join(', ')}
                        </td>
                        <td class="py-2 pr-4 whitespace-nowrap">
                          {formatDateTime(task.createdAt)}
                        </td>
                        <td class="py-2 pr-4">{task.retryCount}</td>
                        <td class="py-2 pr-4">
                          <Show when={isActive(task.status)}>
                            <button
                              type="button"
                              disabled={isActing()}
                              onClick={() => handleCancel(task)}
                              class="text-red-600 hover:underline text-sm disabled:opacity-40"
                            >
                              取消
                            </button>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>
        </div>

        <Pagination
          page={page()}
          pageSize={PAGE_SIZE}
          total={total()}
          onChange={(p) => load(p)}
        />
      </Show>
    </div>
  );
}
