import * as stylex from '@stylexjs/stylex';
import { For, Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { ArrowLeft, Download } from 'lucide-solid';
import { cancelTask, getTaskDetail, getTaskResult } from '@/api/functions/tasks';
import type { TaskDetail } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import StatusBadge from '@/components/StatusBadge';
import { t } from '@/i18n';
import { mineruBackendLabel } from '@/i18n/labels';
import { useApiKey } from '@/stores/api-key-context';
import { useConfirm } from '@/stores/confirm-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';
import { ROUTES, TASK_POLL_INTERVAL_MS, isActiveTaskStatus } from '@/utils/constants';
import { filenameFromContentDisposition, saveBlob, extensionFromContentType } from '@/utils/download';
import { formatDateTime, formatDuration } from '@/utils/format';
import { createPolling } from '@/utils/polling';
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { breakpoint, colors, radius, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/tasks/$id')({
  component: TaskDetailPage,
});

const styles = stylex.create({
  backLink: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px4,
    color: colors.gray600,
    textDecorationLine: 'none',
    ':hover': {
      color: colors.gray900,
    },
  },
  fields: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoint.sm]: 'repeat(3, minmax(0, 1fr))',
    },
    gap: space.px16,
  },
  fileList: {
    listStyleType: 'disc',
    listStylePosition: 'inside',
  },
  errorPre: {
    color: colors.red600,
    backgroundColor: colors.red50,
    borderRadius: radius.px4,
    padding: space.px12,
    whiteSpace: 'pre-wrap',
  },
  actions: {
    display: 'flex',
    gap: space.px12,
  },
});

function Field(props: { label: string; children: import('solid-js').JSX.Element }) {
  return (
    <div>
      <dt {...stylex.attrs(typography.metaMuted, layout.mb2)}>
        {props.label}
      </dt>
      <dd {...stylex.attrs(typography.body)}>{props.children}</dd>
    </div>
  );
}

function TaskDetailPage() {
  const params = Route.useParams();
  const apiKeyStore = useApiKey();
  const toast = useToast();
  const confirm = useConfirm();

  const [task, setTask] = createSignal<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [isActing, setIsActing] = createSignal(false);

  async function load(opts: { silent?: boolean } = {}) {
    const key = apiKeyStore.activeKey();
    if (!key) {
      setIsLoading(false);
      polling.stop();
      return;
    }
    if (!opts.silent) {
      setIsLoading(true);
      setError(null);
    }
    const result = await getTaskDetail(params().id, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      setTask(result.value);
    }
    if (!opts.silent) setIsLoading(false);
    syncPolling();
  }

  // Poll while the task is in flight so the status advances without a manual
  // refresh; stops once it reaches a terminal state.
  const polling = createPolling(
    () => (isActing() ? undefined : load({ silent: true })),
    TASK_POLL_INTERVAL_MS,
  );

  function syncPolling() {
    const status = task()?.status;
    if (status && isActiveTaskStatus(status)) polling.start();
    else polling.stop();
  }

  onMount(() => load());

  async function handleCancel() {
    const key = apiKeyStore.activeKey();
    const cur = task();
    if (!key || !cur) return;
    const confirmed = await confirm.ask({
      title: t('tasks.confirmCancelTitle'),
      description: t('taskDetail.confirmCancel'),
      confirmText: t('taskDetail.cancel'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsActing(true);
    setError(null);
    const result = await cancelTask(cur.taskId, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      toast.show(t('tasks.cancelledToast'), 'success');
    }
    // Silent refresh keeps the detail view mounted while the status flips.
    await load({ silent: true });
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
    <div {...stylex.attrs(layout.stack16, layout.pageWidth768)}>
      <Link
        to={ROUTES.tasks}
        class={stylex.attrs(typography.bodySecondary, styles.backLink).class}
      >
        <ArrowLeft class={stylex.attrs(icons.sm).class} />
        {t('taskDetail.back')}
      </Link>

      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        <Show
          when={!isLoading()}
          fallback={<p {...stylex.attrs(typography.muted)}>{t('common.loading')}</p>}
        >
          <Show when={error()}>
            <p {...stylex.attrs(controls.alert, controls.alertError)}>{error()}</p>
          </Show>

          <Show when={task()}>
            {(task) => (
              <>
                <div {...stylex.attrs(controls.card)}>
                  <div {...stylex.attrs(layout.rowBetween, layout.mb16)}>
                    <h2 {...stylex.attrs(layout.rowCenter12, typography.sectionHeading)}>
                      {t('taskDetail.title')}
                      <code {...stylex.attrs(typography.body)}>{task().taskId}</code>
                    </h2>
                    <StatusBadge status={task().status} />
                  </div>

                  <dl {...stylex.attrs(styles.fields)}>
                    <Field label={t('taskDetail.backend')}>{mineruBackendLabel(task().backend)}</Field>
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

                  <div {...stylex.attrs(layout.mt16)}>
                    <p {...stylex.attrs(typography.metaMuted, layout.mb4)}>
                      {t('taskDetail.fileList')}
                    </p>
                    <ul {...stylex.attrs(typography.body, styles.fileList)}>
                      <For each={task().fileNames}>{(name) => <li>{name}</li>}</For>
                    </ul>
                  </div>

                  <Show when={task().error}>
                    <div {...stylex.attrs(layout.mt16)}>
                      <p {...stylex.attrs(typography.metaMuted, layout.mb4)}>
                        {t('taskDetail.error')}
                      </p>
                      <pre {...stylex.attrs(typography.body, styles.errorPre)}>
                        {task().error}
                      </pre>
                    </div>
                  </Show>
                </div>

                <Show when={task().status === 'failed' && task().hasResult}>
                  <p {...stylex.attrs(controls.alert, controls.alertWarning)}>
                    {t('taskDetail.partialResultHint')}
                  </p>
                </Show>

                <div {...stylex.attrs(styles.actions)}>
                  <Show when={isActiveTaskStatus(task().status)}>
                    <button
                      type="button"
                      disabled={isActing()}
                      onClick={handleCancel}
                      {...stylex.attrs(
                        controls.button,
                        controls.buttonOutline,
                        actions.outlineDanger,
                      )}
                    >
                      {t('taskDetail.cancel')}
                    </button>
                  </Show>
                  <Show when={task().hasResult}>
                    <button
                      type="button"
                      disabled={isActing()}
                      onClick={handleDownload}
                      {...stylex.attrs(
                        controls.button,
                        controls.buttonPrimary,
                        actions.disabled40,
                      )}
                    >
                      <Download class={stylex.attrs(icons.sm).class} />
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
