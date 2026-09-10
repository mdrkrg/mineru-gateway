import { For, Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { ArrowLeft, Download } from 'lucide-solid';
import { cancelTask, getTaskDetail, getTaskResult } from '@/api/functions/tasks';
import type { TaskDetail } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import StatusBadge from '@/components/StatusBadge';
import { t } from '@/i18n';
import { useApiKey } from '@/stores/api-key-context';
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
    const cur = task();
    if (!key || !cur) return;
    if (!window.confirm(t('taskDetail.confirmCancel'))) return;

    setIsActing(true);
    setError(null);
    const result = await cancelTask(cur.taskId, key);
    if (result.isErr()) setError(errorMessage(result.error));
    await load();
    setIsActing(false);
  }

  async function handleDownload() {
    const key = apiKeyStore.activeKey();
    const cur = task();
    if (!key || !cur) return;

    setIsActing(true);
    setError(null);
    const result = await getTaskResult(cur.taskId, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      const contentType = result.value.headers.get('Content-Type');
      const filename =
        filenameFromContentDisposition(
          result.value.headers.get('Content-Disposition'),
        ) ?? `${cur.taskId}${extensionFromContentType(contentType)}`;
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
        {t('taskDetail.back')}
      </Link>

      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        <Show when={!isLoading()} fallback={<p class="text-gray-500">{t('common.loading')}</p>}>
          <Show when={error()}>
            <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error()}
            </p>
          </Show>

          <Show when={task()}>
            {(task) => (
              <>
                <div class="bg-white rounded-lg shadow p-6">
                  <div class="flex items-center justify-between mb-4">
                    <h2 class="text-lg font-semibold flex items-center gap-3">
                      {t('taskDetail.title')} <code class="text-sm">{task().taskId}</code>
                    </h2>
                    <StatusBadge status={task().status} />
                  </div>

                  <dl class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Field label={t('taskDetail.backend')}>{task().backend}</Field>
                    <Field label={t('taskDetail.fileCount')}>{task().fileCount}</Field>
                    <Field label={t('taskDetail.retries')}>{task().retryCount}</Field>
                    <Field label={t('taskDetail.createdAt')}>{formatDateTime(task().createdAt)}</Field>
                    <Field label={t('taskDetail.startedAt')}>{formatDateTime(task().startedAt)}</Field>
                    <Field label={t('taskDetail.completedAt')}>{formatDateTime(task().completedAt)}</Field>
                    <Field label={t('taskDetail.elapsed')}>
                      {(() => {
                        const started = task().startedAt;
                        return started ? formatDuration(started, task().completedAt) : '—';
                      })()}
                    </Field>
                    <Show when={task().queuedAhead !== null}>
                      <Field label={t('taskDetail.queuedAhead')}>{task().queuedAhead}</Field>
                    </Show>
                  </dl>

                  <div class="mt-4">
                    <p class="text-xs text-gray-500 mb-1">{t('taskDetail.fileList')}</p>
                    <ul class="text-sm list-disc list-inside">
                      <For each={task().fileNames}>{(name) => <li>{name}</li>}</For>
                    </ul>
                  </div>

                  <Show when={task().error}>
                    <div class="mt-4">
                      <p class="text-xs text-gray-500 mb-1">{t('taskDetail.error')}</p>
                      <pre class="text-sm text-red-600 bg-red-50 rounded p-3 whitespace-pre-wrap">
                        {task().error}
                      </pre>
                    </div>
                  </Show>
                </div>

                <div class="flex gap-3">
                  <Show when={isActive(task().status)}>
                    <button
                      type="button"
                      disabled={isActing()}
                      onClick={handleCancel}
                      class="border border-red-300 text-red-600 rounded px-4 py-2 text-sm hover:bg-red-50 disabled:opacity-40"
                    >
                      {t('taskDetail.cancel')}
                    </button>
                  </Show>
                  <Show when={task().status === 'completed'}>
                    <button
                      type="button"
                      disabled={isActing()}
                      onClick={handleDownload}
                      class="flex items-center gap-1.5 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
                    >
                      <Download class="w-4 h-4" />
                      {t('taskDetail.download')}
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
