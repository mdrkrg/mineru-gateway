import { For, Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { Download, Package } from 'lucide-solid';
import { downloadResultZip, getTaskResult, listTasks } from '@/api/functions/tasks';
import type { TaskListItem } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import Pagination from '@/components/Pagination';
import { useApiKey } from '@/stores/api-key-context';
import { errorMessage } from '@/utils/api-error';
import { isHttpError } from '@/core/error-model';
import { ROUTES } from '@/utils/constants';
import { filenameFromContentDisposition, saveBlob, extensionFromContentType } from '@/utils/download';
import { formatDateTime } from '@/utils/format';

export const Route = createFileRoute('/_authenticated/download')({
  component: ResultDownloadPage,
});

const PAGE_SIZE = 20;

function ResultDownloadPage() {
  const apiKeyStore = useApiKey();

  const [items, setItems] = createSignal<TaskListItem[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
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
      status: 'completed',
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

  function toggleSelect(taskId: string, checked: boolean) {
    const next = new Set(selected());
    if (checked) next.add(taskId);
    else next.delete(taskId);
    setSelected(next);
  }

  function toggleSelectAll(checked: boolean) {
    setSelected(checked ? new Set(items().map((t) => t.taskId)) : new Set<string>());
  }

  async function handleDownloadOne(task: TaskListItem) {
    const key = apiKeyStore.activeKey();
    if (!key) return;

    setIsActing(true);
    setError(null);
    const result = await getTaskResult(task.taskId, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      const contentType = result.value.headers.get('Content-Type');
      const filename =
        filenameFromContentDisposition(result.value.headers.get('Content-Disposition')) ??
        `${task.taskId}${extensionFromContentType(contentType)}`;
      saveBlob(result.value.blob, filename);
    }
    setIsActing(false);
  }

  async function handleDownloadZip() {
    const key = apiKeyStore.activeKey();
    if (!key) return;
    const ids = [...selected()];
    if (ids.length === 0) return;

    setIsActing(true);
    setError(null);
    const result = await downloadResultZip(ids, key);
    if (result.isErr()) {
      const err = result.error;
      if (isHttpError(err) && err.status === 409) {
        const data = err.data as
          | { detail?: string; nonDownloadable?: { taskId: string; reason: string }[] }
          | undefined;
        const failed = data?.nonDownloadable
          ?.map((item) => `…${item.taskId.slice(-8)}(${item.reason})`)
          .join(',');
        setError(
          `部分任务不可下载:${failed ?? data?.detail ?? '未知原因'}。请取消勾选后重试。`,
        );
      } else {
        setError(errorMessage(err));
      }
    } else {
      const filename =
        filenameFromContentDisposition(result.value.headers.get('Content-Disposition')) ??
        'results.zip';
      saveBlob(result.value.blob, filename);
    }
    setIsActing(false);
  }

  return (
    <div class="flex flex-col gap-4">
      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        <p class="text-sm text-gray-500">
          这里列出所有已完成的任务,可单个下载或勾选后打包下载 ZIP。
        </p>

        <Show when={error()}>
          <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error()}
          </p>
        </Show>

        <div class="flex items-center gap-3">
          <button
            type="button"
            disabled={selected().size === 0 || isActing()}
            onClick={handleDownloadZip}
            class="flex items-center gap-1.5 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Package class="w-4 h-4" />
            打包下载({selected().size})
          </button>
          <button
            type="button"
            onClick={() => load()}
            class="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            刷新
          </button>
        </div>

        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <Show when={!isLoading()} fallback={<p class="p-6 text-gray-500">加载中…</p>}>
            <Show
              when={items().length > 0}
              fallback={<p class="p-6 text-gray-500">还没有已完成的任务。</p>}
            >
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-gray-500 border-b">
                    <th class="py-2 pl-4 pr-2 w-8">
                      <input
                        type="checkbox"
                        checked={items().length > 0 && selected().size === items().length}
                        onChange={(e) => toggleSelectAll(e.currentTarget.checked)}
                      />
                    </th>
                    <th class="py-2 pr-4 font-medium">任务 ID</th>
                    <th class="py-2 pr-4 font-medium">文件</th>
                    <th class="py-2 pr-4 font-medium">完成时间</th>
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
                            checked={selected().has(task.taskId)}
                            onChange={(e) => toggleSelect(task.taskId, e.currentTarget.checked)}
                          />
                        </td>
                        <td class="py-2 pr-4">
                          <Link
                            to={ROUTES.taskDetail(task.taskId)}
                            class="text-blue-600 hover:underline"
                          >
                            <code class="text-xs">…{task.taskId.slice(-8)}</code>
                          </Link>
                        </td>
                        <td class="py-2 pr-4 max-w-64 truncate" title={task.fileNames.join(', ')}>
                          {task.fileNames.join(', ')}
                        </td>
                        <td class="py-2 pr-4 whitespace-nowrap">
                          {formatDateTime(task.completedAt)}
                        </td>
                        <td class="py-2 pr-4">
                          <button
                            type="button"
                            disabled={isActing()}
                            onClick={() => handleDownloadOne(task)}
                            class="flex items-center gap-1 text-blue-600 hover:underline text-sm disabled:opacity-40"
                          >
                            <Download class="w-3.5 h-3.5" />
                            下载
                          </button>
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
