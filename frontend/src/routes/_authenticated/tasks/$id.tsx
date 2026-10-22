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
import { controls } from '@/styles/controls.stylex';
import {
  breakpoint,
  colors,
  fontSize,
  lineHeight,
  maxWidth,
  radius,
  space,
} from '@/styles/tokens.stylex';

export const Route = createFileRoute('/_authenticated/tasks/$id')({
  component: TaskDetailPage,
});

const styles = stylex.create({
  root: {
    maxWidth: maxWidth.px768,
    display: 'flex',
    flexDirection: 'column',
    gap: space.px16,
  },
  backLink: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px4,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray600,
    textDecorationLine: 'none',
    ':hover': {
      color: colors.gray900,
    },
  },
  backIcon: {
    width: space.px16,
    height: space.px16,
  },
  loading: {
    color: colors.gray500,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.px16,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px12,
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
  },
  taskId: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
  },
  fields: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoint.sm]: 'repeat(3, minmax(0, 1fr))',
    },
    gap: space.px16,
  },
  fieldLabel: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    color: colors.gray500,
    marginBottom: space.px2,
  },
  fieldValue: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
  },
  filesSection: {
    marginTop: space.px16,
  },
  smallLabel: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    color: colors.gray500,
    marginBottom: space.px4,
  },
  fileList: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    listStyleType: 'disc',
    listStylePosition: 'inside',
  },
  errorBox: {
    marginTop: space.px16,
  },
  errorPre: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.red600,
    backgroundColor: colors.red50,
    borderRadius: radius.px4,
    padding: space.px12,
    whiteSpace: 'pre-wrap',
  },
  partialHint: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.amber700,
    backgroundColor: colors.amber50,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.amber200,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px8,
  },
  actions: {
    display: 'flex',
    gap: space.px12,
  },
  cancel: {
    borderColor: colors.red300,
    color: colors.red600,
    backgroundColor: {
      default: 'transparent',
      ':hover:not(:disabled)': colors.red50,
    },
    fontWeight: 400,
    opacity: {
      ':disabled': 0.4,
    },
  },
  download: {
    gap: space.px6,
    opacity: {
      ':disabled': 0.4,
    },
  },
  downloadIcon: {
    width: space.px16,
    height: space.px16,
  },
});

function Field(props: { label: string; children: import('solid-js').JSX.Element }) {
  return (
    <div>
      <dt {...stylex.attrs(styles.fieldLabel)}>{props.label}</dt>
      <dd {...stylex.attrs(styles.fieldValue)}>{props.children}</dd>
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
    <div {...stylex.attrs(styles.root)}>
      <Link to={ROUTES.tasks} class={stylex.attrs(styles.backLink).class}>
        <ArrowLeft class={stylex.attrs(styles.backIcon).class} />
        {t('taskDetail.back')}
      </Link>

      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        <Show
          when={!isLoading()}
          fallback={<p {...stylex.attrs(styles.loading)}>{t('common.loading')}</p>}
        >
          <Show when={error()}>
            <p {...stylex.attrs(controls.alertError)}>{error()}</p>
          </Show>

          <Show when={task()}>
            {(task) => (
              <>
                <div {...stylex.attrs(controls.card)}>
                  <div {...stylex.attrs(styles.headerRow)}>
                    <h2 {...stylex.attrs(styles.title)}>
                      {t('taskDetail.title')}
                      <code {...stylex.attrs(styles.taskId)}>{task().taskId}</code>
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

                  <div {...stylex.attrs(styles.filesSection)}>
                    <p {...stylex.attrs(styles.smallLabel)}>{t('taskDetail.fileList')}</p>
                    <ul {...stylex.attrs(styles.fileList)}>
                      <For each={task().fileNames}>{(name) => <li>{name}</li>}</For>
                    </ul>
                  </div>

                  <Show when={task().error}>
                    <div {...stylex.attrs(styles.errorBox)}>
                      <p {...stylex.attrs(styles.smallLabel)}>{t('taskDetail.error')}</p>
                      <pre {...stylex.attrs(styles.errorPre)}>{task().error}</pre>
                    </div>
                  </Show>
                </div>

                <Show when={task().status === 'failed' && task().hasResult}>
                  <p {...stylex.attrs(styles.partialHint)}>
                    {t('taskDetail.partialResultHint')}
                  </p>
                </Show>

                <div {...stylex.attrs(styles.actions)}>
                  <Show when={isActiveTaskStatus(task().status)}>
                    <button
                      type="button"
                      disabled={isActing()}
                      onClick={handleCancel}
                      {...stylex.attrs(controls.button, controls.buttonOutline, styles.cancel)}
                    >
                      {t('taskDetail.cancel')}
                    </button>
                  </Show>
                  <Show when={task().hasResult}>
                    <button
                      type="button"
                      disabled={isActing()}
                      onClick={handleDownload}
                      {...stylex.attrs(controls.button, controls.buttonPrimary, styles.download)}
                    >
                      <Download class={stylex.attrs(styles.downloadIcon).class} />
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
