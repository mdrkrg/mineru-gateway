import * as stylex from '@stylexjs/stylex';
import { For, Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { ArrowLeft } from 'lucide-solid';
import {
  downloadTaskResult,
  getRawTaskResult,
  getTaskDetail,
} from '@/api/functions/tasks';
import type { TaskDetail } from '@/api/schemas/tasks';
import DownloadSplitButton from '@/components/DownloadSplitButton';
import StatusBadge from '@/components/StatusBadge';
import { t } from '@/i18n';
import { taskTierLabel } from '@/i18n/labels';
import { useConfirm } from '@/stores/confirm-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';
import { ROUTES, TASK_POLL_INTERVAL_MS, isActiveTaskStatus } from '@/utils/constants';
import { downloadResultFile } from '@/utils/download';
import type { ResultFetcher } from '@/utils/download';
import { formatDateTime, formatDuration } from '@/utils/format';
import { createPolling } from '@/utils/polling';
import { runTaskCancel } from '@/utils/task-actions';
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { breakpoint, colors, fontSize, lineHeight, radius, space } from '@/styles/tokens.stylex';
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
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.px12,
    rowGap: space.px4,
    marginBottom: space.px16,
  },
  taskId: {
    order: { default: 2, [breakpoint.sm]: 1 },
    flexBasis: { default: '100%', [breakpoint.sm]: 'auto' },
    minWidth: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: { default: fontSize.px12, [breakpoint.sm]: fontSize.px14 },
    lineHeight: { default: lineHeight.px16, [breakpoint.sm]: lineHeight.px20 },
    color: { default: colors.gray500, [breakpoint.sm]: colors.gray800 },
    overflowWrap: 'anywhere',
  },
  status: {
    order: { default: 1, [breakpoint.sm]: 2 },
    display: 'flex',
    flexShrink: 0,
    marginLeft: 'auto',
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
  const toast = useToast();
  const confirm = useConfirm();

  const [task, setTask] = createSignal<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [isActing, setIsActing] = createSignal(false);

  async function load(opts: { silent?: boolean } = {}) {
    if (!opts.silent) {
      setIsLoading(true);
      setError(null);
    }
    const result = await getTaskDetail(params().id);
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
    const cur = task();
    if (!cur) return;
    await runTaskCancel({
      confirm,
      toast,
      taskId: cur.taskId,
      description: t('taskDetail.confirmCancel'),
      setError,
      setActing: setIsActing,
      reload: () => load({ silent: true }),
    });
  }

  async function runDownload(fetchResult: ResultFetcher) {
    const cur = task();
    if (!cur) return;

    setIsActing(true);
    setError(null);
    setError(await downloadResultFile(fetchResult, cur.taskId, cur.fileNames));
    setIsActing(false);
  }

  const handleDownload = () => runDownload(downloadTaskResult);
  const handleDownloadRaw = () => runDownload(getRawTaskResult);

  return (
    <div {...stylex.attrs(layout.stack16, layout.pageWidth768)}>
      <Link
        to={ROUTES.tasks}
        class={stylex.attrs(typography.bodySecondary, styles.backLink).class}
      >
        <ArrowLeft class={stylex.attrs(icons.sm).class} />
        {t('taskDetail.back')}
      </Link>

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
                <div {...stylex.attrs(styles.header)}>
                  <h2 {...stylex.attrs(typography.sectionHeading)}>
                    {t('taskDetail.title')}
                  </h2>
                  <code {...stylex.attrs(styles.taskId)}>{task().taskId}</code>
                  <div {...stylex.attrs(styles.status)}>
                    <StatusBadge status={task().status} />
                  </div>
                </div>

                <dl {...stylex.attrs(styles.fields)}>
                  <Field label={t('taskDetail.tier')}>
                    {taskTierLabel(task().tier)}
                  </Field>
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

              <Show when={task().status === 'partial' && task().hasResult}>
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
                  <DownloadSplitButton
                    label={t('taskDetail.download')}
                    rawLabel={t('taskDetail.downloadRaw')}
                    rawHint={t('taskDetail.downloadRawHint')}
                    disabled={isActing()}
                    onDownload={handleDownload}
                    onDownloadRaw={handleDownloadRaw}
                  />
                </Show>
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
