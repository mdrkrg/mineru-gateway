import * as stylex from '@stylexjs/stylex';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
} from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { Download, Package, X } from 'lucide-solid';
import {
  batchCancelTasks,
  cancelTask,
  downloadResultZip,
  downloadTaskResult,
  listTasks,
} from '@/api/functions/tasks';
import type { TaskListItem } from '@/api/schemas/tasks';
import Pagination from '@/components/Pagination';
import SelectField from '@/components/SelectField';
import StatusBadge from '@/components/StatusBadge';
import TaskFileCell from '@/components/TaskFileCell';
import { isHttpError } from '@/core/error-model';
import { t } from '@/i18n';
import { taskStatusLabel, taskTierLabel } from '@/i18n/labels';
import { useConfirm } from '@/stores/confirm-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';
import {
  ROUTES,
  TASK_POLL_INTERVAL_MS,
  TASK_STATUSES,
  isActiveTaskStatus,
  taskViewFromSearch,
} from '@/utils/constants';
import {
  downloadResultFile,
  filenameFromContentDisposition,
  saveBlob,
} from '@/utils/download';
import { formatDateTime, shortTaskId } from '@/utils/format';
import { createPolling } from '@/utils/polling';
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { forms } from '@/styles/forms.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { table } from '@/styles/table.stylex';
import {
  breakpoint,
  colors,
  motion,
  radius,
  shadow,
  space,
} from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/tasks/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: 'results' } => ({
    // Only `results` needs to be in the URL; the default all-tasks view stays
    // at the bare `/tasks` path.
    view: search.view === 'results' ? 'results' : undefined,
  }),
  component: TaskListPage,
});

const PAGE_SIZE = 20;

const styles = stylex.create({
  tabList: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    gap: space.px4,
    padding: space.px4,
    backgroundColor: colors.gray100,
    borderRadius: radius.px8,
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: radius.px4,
    paddingInline: space.px16,
    paddingBlock: space.px6,
    fontWeight: 500,
    color: colors.gray600,
    textDecorationLine: 'none',
    transitionProperty: motion.colors,
    transitionTimingFunction: motion.easing,
    transitionDuration: motion.duration,
    ':hover': {
      color: colors.gray900,
    },
  },
  tabActive: {
    backgroundColor: colors.white,
    color: colors.gray900,
    boxShadow: shadow.base,
  },
  filterForm: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: space.px12,
    padding: space.px16,
  },
  actionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.px12,
  },
  tableWrap: {
    display: { default: 'none', [breakpoint.sm]: 'block' },
  },
  cardList: {
    display: { default: 'flex', [breakpoint.sm]: 'none' },
    flexDirection: 'column',
    gap: space.px12,
  },
  taskCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px12,
    padding: space.px16,
    backgroundColor: colors.white,
    borderRadius: radius.px8,
    boxShadow: shadow.base,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.px12,
  },
  cardCheck: {
    marginTop: space.px2,
    flexShrink: 0,
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px4,
    flex: 1,
    minWidth: 0,
  },
  cardTop: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.px4,
  },
  cardFile: {
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  cardMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: space.px12,
    rowGap: space.px4,
  },
  cardActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: space.px8,
  },
  rowActions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.px12,
  },
  emptyCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.px8,
    padding: space.px24,
  },
});

function TaskListPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const search = Route.useSearch();

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

  const view = () => taskViewFromSearch(search().view);
  const isResults = () => view() === 'results';

  const statusOptions = createMemo(() =>
    TASK_STATUSES.map((status) => ({ value: status, label: taskStatusLabel(status) })),
  );

  function isSelectable(task: TaskListItem): boolean {
    return isResults() || isActiveTaskStatus(task.status);
  }

  const selectableTasks = () =>
    isResults() ? items() : items().filter((task) => isActiveTaskStatus(task.status));

  const hasFilters = () =>
    Boolean(appliedFilters().status || appliedFilters().fileName.trim());

  async function load(targetPage = page(), opts: { silent?: boolean } = {}) {
    if (!opts.silent) {
      setIsLoading(true);
      setError(null);
    }

    const filters = appliedFilters();
    const result = await listTasks({
      hasResult: isResults() ? true : undefined,
      status: isResults() ? undefined : filters.status || undefined,
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
      if (!opts.silent) {
        setSelected(new Set<string>());
      } else {
        // A silent poll can move a selected task into a terminal state; drop
        // it so the contextual batch action never sends an ineligible id.
        const eligible = new Set(
          (isResults()
            ? result.value.items
            : result.value.items.filter((task) => isActiveTaskStatus(task.status))
          ).map((task) => task.taskId),
        );
        setSelected(
          (current) => new Set([...current].filter((id) => eligible.has(id))),
        );
      }
    }
    if (!opts.silent) setIsLoading(false);
    syncPolling();
  }

  const hasActiveTasks = () =>
    !isResults() && items().some((task) => isActiveTaskStatus(task.status));

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

  // Switching views is a real navigation, so reset page-level state instead
  // of keeping a selection that belongs to the other tab's action.
  createEffect(
    on(
      view,
      () => {
        setStatusFilter('');
        setAppliedFilters((current) => ({ ...current, status: '' }));
        setSelected(new Set<string>());
        setPage(1);
        load(1);
      },
      { defer: true },
    ),
  );

  onMount(() => load(1));

  function applyFilters(e: SubmitEvent) {
    e.preventDefault();
    setAppliedFilters({
      status: isResults() ? '' : statusFilter(),
      fileName: fileNameFilter(),
    });
    load(1);
  }

  function clearFilters() {
    setStatusFilter('');
    setFileNameFilter('');
    setAppliedFilters({ status: '', fileName: '' });
    load(1);
  }

  function toggleSelect(taskId: string, checked: boolean) {
    const next = new Set(selected());
    if (checked) next.add(taskId);
    else next.delete(taskId);
    setSelected(next);
  }

  function toggleSelectAll(checked: boolean) {
    setSelected(
      checked ? new Set(selectableTasks().map((task) => task.taskId)) : new Set<string>(),
    );
  }

  async function handleCancel(task: TaskListItem) {
    const confirmed = await confirm.ask({
      title: t('tasks.confirmCancelTitle'),
      description: t('tasks.confirmCancel', { shortId: shortTaskId(task.taskId) }),
      confirmText: t('taskDetail.cancel'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsActing(true);
    setError(null);
    const result = await cancelTask(task.taskId);
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
    const result = await batchCancelTasks(ids);
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

  async function handleDownloadOne(task: TaskListItem) {
    setIsActing(true);
    setError(null);
    setError(
      await downloadResultFile(downloadTaskResult, task.taskId, task.fileNames),
    );
    setIsActing(false);
  }

  async function handleDownloadZip() {
    const ids = [...selected()];
    if (ids.length === 0) return;

    setIsActing(true);
    setError(null);
    const result = await downloadResultZip(ids);
    if (result.isErr()) {
      const err = result.error;
      if (isHttpError(err) && err.status === 409) {
        const data = err.data as
          | { detail?: string; nonDownloadable?: { taskId: string; reason: string }[] }
          | undefined;
        const failed = data?.nonDownloadable
          ?.map((item) => `…${shortTaskId(item.taskId)}(${item.reason})`)
          .join(t('common.listSeparator'));
        setError(
          t('tasks.notDownloadable', {
            failed: failed ?? data?.detail ?? t('tasks.unknownReason'),
          }),
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

  function emptyText() {
    if (hasFilters()) return t('tasks.empty');
    return isResults() ? t('tasks.resultsEmpty') : t('tasks.emptyNoTasks');
  }

  return (
    <div {...stylex.attrs(layout.stack16)}>
      {/* The two views are links, not client-only tabs: the URL stays
          shareable and the browser back button switches views naturally. */}
      <nav
        aria-label={t('tasks.viewsLabel')}
        {...stylex.attrs(styles.tabList)}
      >
        <Link
          to={ROUTES.tasks}
          search={{}}
          aria-current={!isResults() ? 'page' : undefined}
          class={
            stylex.attrs(
              typography.body,
              styles.tab,
              !isResults() ? styles.tabActive : null,
            ).class
          }
        >
          {t('tasks.tabAll')}
        </Link>
        <Link
          to={ROUTES.tasks}
          search={{ view: 'results' }}
          aria-current={isResults() ? 'page' : undefined}
          class={
            stylex.attrs(
              typography.body,
              styles.tab,
              isResults() ? styles.tabActive : null,
            ).class
          }
        >
          {t('tasks.tabResults')}
        </Link>
      </nav>

      {/* Filters. The results view already implies completed/partial, so a
          status selector there could only produce empty pages. */}
      <form
        onSubmit={applyFilters}
        {...stylex.attrs(controls.card, styles.filterForm)}
      >
        <Show when={!isResults()}>
          <SelectField
            label={t('tasks.filterStatus')}
            value={statusFilter()}
            placeholder={t('tasks.filterAll')}
            options={statusOptions()}
            onChange={setStatusFilter}
          />
        </Show>
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

      {/* One contextual batch action per view, so cancel and ZIP can never be
          mixed up. */}
      <div {...stylex.attrs(styles.actionRow)}>
        <Show
          when={isResults()}
          fallback={
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
          }
        >
          <button
            type="button"
            disabled={selected().size === 0 || isActing()}
            onClick={handleDownloadZip}
            {...stylex.attrs(
              controls.button,
              controls.buttonPrimary,
              actions.disabled40,
            )}
          >
            <Package class={stylex.attrs(icons.sm).class} />
            {t('tasks.pack', { count: selected().size })}
          </button>
        </Show>
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
        <span {...stylex.attrs(typography.metaMuted)}>
          {isResults() ? t('tasks.downloadHint') : t('tasks.autoRefreshHint')}
        </span>
      </div>

      <Show
        when={!isLoading()}
        fallback={
          <div {...stylex.attrs(table.card)}>
            <p {...stylex.attrs(table.message)}>{t('common.loading')}</p>
          </div>
        }
      >
        <Show
          when={items().length > 0}
          fallback={
            <div {...stylex.attrs(table.card, styles.emptyCard)}>
              <p {...stylex.attrs(typography.bodyMuted)}>{emptyText()}</p>
              <Show
                when={hasFilters()}
                fallback={
                  <Show
                    when={isResults()}
                    fallback={
                      <Link
                        to={ROUTES.upload}
                        class={stylex.attrs(controls.link, typography.body).class}
                      >
                        {t('tasks.uploadCta')}
                      </Link>
                    }
                  >
                    <Link
                      to={ROUTES.tasks}
                      search={{}}
                      class={stylex.attrs(controls.link, typography.body).class}
                    >
                      {t('tasks.viewAll')}
                    </Link>
                  </Show>
                }
              >
                <button
                  type="button"
                  onClick={clearFilters}
                  {...stylex.attrs(
                    controls.button,
                    controls.buttonOutline,
                    actions.outlineCompact,
                  )}
                >
                  {t('common.clear')}
                </button>
              </Show>
            </div>
          }
        >
          {/* Desktop/tablet table. */}
          <div {...stylex.attrs(styles.tableWrap)}>
            <div {...stylex.attrs(table.card)}>
              <table {...stylex.attrs(table.root)}>
                <thead>
                  <tr {...stylex.attrs(table.headRow)}>
                    <th {...stylex.attrs(table.thCheck)}>
                      <input
                        type="checkbox"
                        checked={
                          selectableTasks().length > 0 &&
                          selected().size === selectableTasks().length
                        }
                        onChange={(e) => toggleSelectAll(e.currentTarget.checked)}
                        disabled={selectableTasks().length === 0}
                      />
                    </th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thFiles')}</th>
                    <th {...stylex.attrs(table.th)}>{t('tasks.thStatus')}</th>
                    <Show
                      when={!isResults()}
                      fallback={
                        <th {...stylex.attrs(table.th)}>{t('tasks.thCompletedAt')}</th>
                      }
                    >
                      <th {...stylex.attrs(table.th)}>{t('tasks.thTier')}</th>
                      <th {...stylex.attrs(table.th)}>{t('tasks.thCreatedAt')}</th>
                      <th {...stylex.attrs(table.th)}>{t('tasks.thRetries')}</th>
                    </Show>
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
                            disabled={!isSelectable(task)}
                            checked={selected().has(task.taskId)}
                            onChange={(e) =>
                              toggleSelect(task.taskId, e.currentTarget.checked)
                            }
                          />
                        </td>
                        <td {...stylex.attrs(table.truncate, table.truncateNarrow)}>
                          <TaskFileCell taskId={task.taskId} fileNames={task.fileNames} />
                        </td>
                        <td {...stylex.attrs(table.td)}>
                          <StatusBadge status={task.status} />
                        </td>
                        <Show
                          when={!isResults()}
                          fallback={
                            <td {...stylex.attrs(table.nowrap)}>
                              {formatDateTime(task.completedAt)}
                            </td>
                          }
                        >
                          <td {...stylex.attrs(table.td, typography.meta)}>
                            {taskTierLabel(task.tier)}
                          </td>
                          <td {...stylex.attrs(table.nowrap)}>
                            {formatDateTime(task.createdAt)}
                          </td>
                          <td {...stylex.attrs(table.td)}>{task.retryCount}</td>
                        </Show>
                        <td {...stylex.attrs(table.td)}>
                          <div {...stylex.attrs(styles.rowActions)}>
                            <Show when={!isResults() && isActiveTaskStatus(task.status)}>
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
                            <Show when={task.hasResult}>
                              <button
                                type="button"
                                disabled={isActing()}
                                onClick={() => handleDownloadOne(task)}
                                {...stylex.attrs(
                                  actions.text,
                                  actions.textPrimary,
                                  actions.disabled40,
                                )}
                              >
                                <Download class={stylex.attrs(icons.xs).class} />
                                {t('tasks.downloadAction')}
                              </button>
                            </Show>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>

          {/* Phone cards: keep the primary action visible without a
              horizontally scrolling table. */}
          <div {...stylex.attrs(styles.cardList)}>
            <For each={items()}>
              {(task) => (
                <article {...stylex.attrs(styles.taskCard)}>
                  <div {...stylex.attrs(styles.cardHeader)}>
                    <input
                      type="checkbox"
                      disabled={!isSelectable(task)}
                      checked={selected().has(task.taskId)}
                      onChange={(e) =>
                        toggleSelect(task.taskId, e.currentTarget.checked)
                      }
                      {...stylex.attrs(styles.cardCheck)}
                    />
                    <div {...stylex.attrs(styles.cardBody)}>
                      <div {...stylex.attrs(styles.cardTop)}>
                        <div {...stylex.attrs(styles.cardFile)}>
                          <TaskFileCell
                            taskId={task.taskId}
                            fileNames={task.fileNames}
                          />
                        </div>
                        <StatusBadge status={task.status} />
                      </div>
                      <div
                        {...stylex.attrs(typography.metaMuted, styles.cardMeta)}
                      >
                        <span>{taskTierLabel(task.tier)}</span>
                        <span>
                          {formatDateTime(
                            isResults() ? task.completedAt : task.createdAt,
                          )}
                        </span>
                        <Show when={!isResults() && task.retryCount > 0}>
                          <span>{t('tasks.retryCount', { count: task.retryCount })}</span>
                        </Show>
                      </div>
                    </div>
                  </div>

                  <Show
                    when={
                      (!isResults() && isActiveTaskStatus(task.status)) ||
                      task.hasResult
                    }
                  >
                    <div {...stylex.attrs(styles.cardActions)}>
                      <Show when={!isResults() && isActiveTaskStatus(task.status)}>
                        <button
                          type="button"
                          disabled={isActing()}
                          onClick={() => handleCancel(task)}
                          {...stylex.attrs(
                            controls.button,
                            controls.buttonOutline,
                            actions.outlineDanger,
                            actions.outlineCompact,
                          )}
                        >
                          <X class={stylex.attrs(icons.sm).class} />
                          {t('tasks.cancel')}
                        </button>
                      </Show>
                      <Show when={task.hasResult}>
                        <button
                          type="button"
                          disabled={isActing()}
                          onClick={() => handleDownloadOne(task)}
                          {...stylex.attrs(
                            controls.button,
                            controls.buttonPrimary,
                            actions.outlineCompact,
                            actions.disabled40,
                          )}
                        >
                          <Download class={stylex.attrs(icons.sm).class} />
                          {t('tasks.downloadAction')}
                        </button>
                      </Show>
                    </div>
                  </Show>
                </article>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Pagination
        page={page()}
        pageSize={PAGE_SIZE}
        total={total()}
        onChange={(p) => load(p)}
      />
    </div>
  );
}
