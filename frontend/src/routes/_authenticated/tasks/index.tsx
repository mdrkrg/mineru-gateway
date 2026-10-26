import * as stylex from '@stylexjs/stylex';
import { For, Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { listTasks, cancelTask, batchCancelTasks } from '@/api/functions/tasks';
import type { TaskListItem } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import Pagination from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';
import { t } from '@/i18n';
import { taskStatusLabel, taskTierLabel } from '@/i18n/labels';
import { useApiKey } from '@/stores/api-key-context';
import { useConfirm } from '@/stores/confirm-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';
import {
  ROUTES,
  TASK_POLL_INTERVAL_MS,
  TASK_STATUSES,
  isActiveTaskStatus,
} from '@/utils/constants';
import { formatDateTime } from '@/utils/format';
import { createPolling } from '@/utils/polling';
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { forms } from '@/styles/forms.stylex';
import { layout } from '@/styles/layout.stylex';
import { table } from '@/styles/table.stylex';
import { space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/tasks/')({
  component: TaskListPage,
});

const PAGE_SIZE = 20;

const styles = stylex.create({
  filterForm: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: space.px12,
    padding: space.px16,
  },
});

function TaskListPage() {
  const apiKeyStore = useApiKey();
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = createSignal<TaskListItem[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [statusFilter, setStatusFilter] = createSignal('');
  const [fileNameFilter, setFileNameFilter] = createSignal('');
  const [appliedFilters, setAppliedFilters] = createSignal({ status: '', fileName: '' });
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [isActing, setIsActing] = createSignal(false);

  async function load(targetPage = page(), opts: { silent?: boolean } = {}) {
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

    const filters = appliedFilters();
    const result = await listTasks({
      apiKey: key,
      status: filters.status || undefined,
      fileName: filters.fileName.trim() || undefined,
      page: targetPage,
      pageSize: PAGE_SIZE,
    });
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      setItems(result.value.items);
      setTotal(result.value.total);
      setPage(result.value.page);
      if (!opts.silent) setSelected(new Set<string>());
    }
    if (!opts.silent) setIsLoading(false);
    syncPolling();
  }

  const hasActiveTasks = () =>
    items().some((task) => isActiveTaskStatus(task.status));

  // Refresh in-flight tasks silently so status advances without losing the
  // current selection or flashing the loading state.
  const polling = createPolling(
    () => (isActing() ? undefined : load(page(), { silent: true })),
    TASK_POLL_INTERVAL_MS,
  );

  function syncPolling() {
    if (hasActiveTasks()) polling.start();
    else polling.stop();
  }

  onMount(() => load(1));

  function applyFilters(e: SubmitEvent) {
    e.preventDefault();
    setAppliedFilters({ status: statusFilter(), fileName: fileNameFilter() });
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
    setSelected(
      new Set(items().filter((t) => isActiveTaskStatus(t.status)).map((t) => t.taskId)),
    );
  }

  async function handleCancel(task: TaskListItem) {
    const key = apiKeyStore.activeKey();
    if (!key) return;
    const confirmed = await confirm.ask({
      title: t('tasks.confirmCancelTitle'),
      description: t('tasks.confirmCancel', { shortId: task.taskId.slice(-8) }),
      confirmText: t('taskDetail.cancel'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsActing(true);
    setError(null);
    const result = await cancelTask(task.taskId, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      toast.show(t('tasks.cancelledToast'), 'success');
    }
    // Silent refresh keeps the list mounted; clear the selection explicitly
    // since `load` only resets it on non-silent loads.
    await load(page(), { silent: true });
    setSelected(new Set<string>());
    setIsActing(false);
  }

  async function handleBatchCancel() {
    const key = apiKeyStore.activeKey();
    if (!key) return;
    const ids = [...selected()];
    if (ids.length === 0) return;
    const confirmed = await confirm.ask({
      title: t('tasks.confirmBatchCancelTitle'),
      description: t('tasks.confirmBatchCancel', { count: ids.length }),
      confirmText: t('tasks.confirmBatchCancelText'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsActing(true);
    setError(null);
    const result = await batchCancelTasks(ids, key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      if (result.value.errors.length > 0) {
        setError(
          t('tasks.batchResult', {
            cancelled: result.value.cancelledCount,
            failed: result.value.errors.length,
          }),
        );
      }
      if (result.value.cancelledCount > 0) {
        toast.show(
          t('tasks.batchCancelToast', { count: result.value.cancelledCount }),
          'success',
        );
      }
    }
    await load(page(), { silent: true });
    setSelected(new Set<string>());
    setIsActing(false);
  }

  const selectableCount = () =>
    items().filter((t) => isActiveTaskStatus(t.status)).length;

  return (
    <div {...stylex.attrs(layout.stack16)}>
      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        {/* Filters */}
        <form
          onSubmit={applyFilters}
          {...stylex.attrs(controls.card, styles.filterForm)}
        >
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('tasks.filterStatus')}</span>
            <select
              value={statusFilter()}
              onChange={(e) => setStatusFilter(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            >
              <option value="">{t('tasks.filterAll')}</option>
              <For each={TASK_STATUSES}>
                {(s) => <option value={s}>{taskStatusLabel(s)}</option>}
              </For>
            </select>
          </label>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('tasks.filterFileName')}</span>
            <input
              type="text"
              value={fileNameFilter()}
              onInput={(e) => setFileNameFilter(e.currentTarget.value)}
              placeholder={t('tasks.searchPlaceholder')}
              {...stylex.attrs(controls.input, forms.inputMedium)}
            />
          </label>
          <button
            type="submit"
            {...stylex.attrs(controls.button, controls.buttonPrimary)}
          >
            {t('tasks.search')}
          </button>
        </form>

        <Show when={error()}>
          <p {...stylex.attrs(controls.alert, controls.alertError)}>{error()}</p>
        </Show>

        {/* Batch actions */}
        <div {...stylex.attrs(layout.rowCenter12)}>
          <button
            type="button"
            disabled={selected().size === 0 || isActing()}
            onClick={handleBatchCancel}
            {...stylex.attrs(
              controls.button,
              controls.buttonOutline,
              actions.outlineDanger,
              actions.outlineCompact,
            )}
          >
            {t('tasks.batchCancel', { count: selected().size })}
          </button>
          <button
            type="button"
            onClick={() => load()}
            {...stylex.attrs(
              controls.button,
              controls.buttonOutline,
              actions.outlineCompact,
            )}
          >
            {t('common.refresh')}
          </button>
          <Show when={hasActiveTasks()}>
            <span {...stylex.attrs(typography.metaMuted)}>
              {t('tasks.autoRefreshHint')}
            </span>
          </Show>
        </div>

        {/* Table */}
        <div {...stylex.attrs(table.card)}>
          <Show
            when={!isLoading()}
            fallback={<p {...stylex.attrs(table.message)}>{t('common.loading')}</p>}
          >
            <Show
              when={items().length > 0}
              fallback={<p {...stylex.attrs(table.message)}>{t('tasks.empty')}</p>}
            >
              <table {...stylex.attrs(table.root)}>
                <thead>
                  <tr {...stylex.attrs(table.headRow)}>
                    <th {...stylex.attrs(table.thCheck)}>
                      <input
                        type="checkbox"
                        checked={selectableCount() > 0 && selected().size === selectableCount()}
                        onChange={(e) => toggleSelectAll(e.currentTarget.checked)}
                        disabled={selectableCount() === 0}
                      />
                    </th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thTaskId')}</th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thStatus')}</th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thTier')}</th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thFiles')}</th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thCreatedAt')}</th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thRetries')}</th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={items()}>
                    {(task, index) => (
                      <tr
                        {...stylex.attrs(
                          table.row,
                          index() === items().length - 1 && table.lastRow,
                        )}
                      >
                        <td {...stylex.attrs(table.tdCheck)}>
                          <input
                            type="checkbox"
                            disabled={!isActiveTaskStatus(task.status)}
                            checked={selected().has(task.taskId)}
                            onChange={(e) => toggleSelect(task.taskId, e.currentTarget.checked)}
                          />
                        </td>
                        <td {...stylex.attrs(table.td)}>
                          <Link
                            to={ROUTES.taskDetail(task.taskId)}
                            class={stylex.attrs(controls.link, typography.body).class}
                          >
                            <code {...stylex.attrs(typography.meta)}>
                              …{task.taskId.slice(-8)}
                            </code>
                          </Link>
                        </td>
                        <td {...stylex.attrs(table.td)}>
                          <StatusBadge status={task.status} />
                        </td>
                        <td {...stylex.attrs(table.td, typography.meta)}>
                          {taskTierLabel(task.tier)}
                        </td>
                        <td
                          {...stylex.attrs(table.truncate, table.truncateNarrow)}
                          title={task.fileNames.join(', ')}
                        >
                          {task.fileNames.join(', ')}
                        </td>
                        <td {...stylex.attrs(table.nowrap)}>
                          {formatDateTime(task.createdAt)}
                        </td>
                        <td {...stylex.attrs(table.td)}>{task.retryCount}</td>
                        <td {...stylex.attrs(table.td)}>
                          <Show when={isActiveTaskStatus(task.status)}>
                            <button
                              type="button"
                              disabled={isActing()}
                              onClick={() => handleCancel(task)}
                              {...stylex.attrs(
                                actions.text,
                                actions.textDanger,
                                actions.disabled40,
                              )}
                            >
                              {t('tasks.cancel')}
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
