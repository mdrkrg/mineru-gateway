import { For, Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { ArrowLeft, Download } from 'lucide-solid';
import { cancelTask, getTaskDetail, getTaskResult } from '@/api/functions/tasks';
import type { TaskDetail } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import StatusBadge from '@/components/StatusBadge';
import { useApiKey } from '@/stores/api-key-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';
import { ACTIVE_TASK_STATUSES, ROUTES } from '@/utils/constants';
import { filenameFromContentDisposition, saveBlob, extensionFromContentType } from '@/utils/download';
import { formatDateTime, formatDuration } from '@/utils/format';

export const Route = createFileRoute('/_authenticated/tasks/$id')({
  component: TaskDetailPage,
});

const isActive = (status: string) =>
  (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);

function Field(props: { label: string; children: import('solid-js').JSX.Element }) {
  return (
    <div>
      <dt class="text-xs text-gray-500 mb-0.5">{props.label}</dt>
      <dd class="text-sm">{props.children}</dd>
    </div>
  );
}

function TaskDetailPage() {
  const params = Route.useParams();
  const apiKeyStore = useApiKey();
  const toast = useToast();

  const [task, setTask] = createSignal<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [isActing, setIsActing] = createSignal(false);

  async function load() {
    const key = apiKeyStore.activeKey();
    if (!key) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    const result = await getTaskDetail(params().id, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      setTask(result.value);
    }
    setIsLoading(false);
  }

  onMount(load);

  async function handleCancel() {
    const key = apiKeyStore.activeKey();
    const t = task();
    if (!key || !t) return;
    if (!window.confirm('确定取消该任务吗?')) return;

    setIsActing(true);
    setError(null);
    const result = await cancelTask(t.taskId, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      toast.show('任务已取消', 'success');
    }
    await load();
    setIsActing(false);
  }

  async function handleDownload() {
    const key = apiKeyStore.activeKey();
    const t = task();
    if (!key || !t) return;

    setIsActing(true);
    setError(null);
    const result = await getTaskResult(t.taskId, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      const contentType = result.value.headers.get('Content-Type');
      const filename =
        filenameFromContentDisposition(
          result.value.headers.get('Content-Disposition'),
        ) ?? `${t.taskId}${extensionFromContentType(contentType)}`;
      saveBlob(result.value.blob, filename);
    }
    setIsActing(false);
  }

  return (
    <div class="max-w-3xl flex flex-col gap-4">
      <Link
        to={ROUTES.tasks}
        class="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft class="w-4 h-4" />
        返回任务列表
      </Link>

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

          <Show when={task()}>
            {(t) => (
              <>
                <div class="bg-white rounded-lg shadow p-6">
                  <div class="flex items-center justify-between mb-4">
                    <h2 class="text-lg font-semibold flex items-center gap-3">
                      任务 <code class="text-sm">{t().taskId}</code>
                    </h2>
                    <StatusBadge status={t().status} />
                  </div>

                  <dl class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Field label="后端">{t().backend}</Field>
                    <Field label="文件数">{t().fileCount}</Field>
                    <Field label="重试次数">{t().retryCount}</Field>
                    <Field label="创建时间">{formatDateTime(t().createdAt)}</Field>
                    <Field label="开始时间">{formatDateTime(t().startedAt)}</Field>
                    <Field label="完成时间">{formatDateTime(t().completedAt)}</Field>
                    <Field label="耗时">
                      {(() => {
                        const started = t().startedAt;
                        return started ? formatDuration(started, t().completedAt) : '—';
                      })()}
                    </Field>
                    <Show when={t().queuedAhead !== null}>
                      <Field label="排队前方任务数">{t().queuedAhead}</Field>
                    </Show>
                  </dl>

                  <div class="mt-4">
                    <p class="text-xs text-gray-500 mb-1">文件列表</p>
                    <ul class="text-sm list-disc list-inside">
                      <For each={t().fileNames}>{(name) => <li>{name}</li>}</For>
                    </ul>
                  </div>

                  <Show when={t().error}>
                    <div class="mt-4">
                      <p class="text-xs text-gray-500 mb-1">错误信息</p>
                      <pre class="text-sm text-red-600 bg-red-50 rounded p-3 whitespace-pre-wrap">
                        {t().error}
                      </pre>
                    </div>
                  </Show>
                </div>

                <div class="flex gap-3">
                  <Show when={isActive(t().status)}>
                    <button
                      type="button"
                      disabled={isActing()}
                      onClick={handleCancel}
                      class="border border-red-300 text-red-600 rounded px-4 py-2 text-sm hover:bg-red-50 disabled:opacity-40"
                    >
                      取消任务
                    </button>
                  </Show>
                  <Show when={t().status === 'completed'}>
                    <button
                      type="button"
                      disabled={isActing()}
                      onClick={handleDownload}
                      class="flex items-center gap-1.5 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
                    >
                      <Download class="w-4 h-4" />
                      下载结果
                    </button>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
