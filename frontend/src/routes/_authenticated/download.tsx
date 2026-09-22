import * as stylex from '@stylexjs/stylex';
import { For, Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { Download, Package } from 'lucide-solid';
import { downloadResultZip, getTaskResult, listTasks } from '@/api/functions/tasks';
import type { TaskListItem } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import Pagination from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';
import { t } from '@/i18n';
import { useApiKey } from '@/stores/api-key-context';
import { errorMessage } from '@/utils/api-error';
import { isHttpError } from '@/core/error-model';
import { ROUTES } from '@/utils/constants';
import { filenameFromContentDisposition, saveBlob, extensionFromContentType } from '@/utils/download';
import { formatDateTime } from '@/utils/format';
import { controls } from '@/styles/controls.stylex';
import { actionButton, table } from '@/styles/table.stylex';
import {
  colors,
  fontSize,
  lineHeight,
  space,
} from '@/styles/tokens.stylex';

export const Route = createFileRoute('/_authenticated/download')({
  component: ResultDownloadPage,
});

const PAGE_SIZE = 20;

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px16,
  },
  description: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
  },
  actionBar: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px12,
  },
  packButton: {
    gap: space.px6,
  },
  packIcon: {
    width: space.px16,
    height: space.px16,
  },
  downloadButton: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px4,
    color: colors.blue600,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: {
      default: 'pointer',
      ':disabled': 'not-allowed',
    },
    textDecorationLine: {
      default: 'none',
      ':enabled:hover': 'underline',
    },
    opacity: {
      ':disabled': 0.4,
    },
  },
  downloadIcon: {
    width: space.px14,
    height: space.px14,
  },
});

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
      hasResult: true,
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
          .join(t('common.listSeparator'));
        setError(
          t('download.notDownloadable', {
            failed: failed ?? data?.detail ?? t('download.unknownReason'),
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

  return (
    <div {...stylex.attrs(styles.root)}>
      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        <p {...stylex.attrs(styles.description)}>{t('download.description')}</p>

        <Show when={error()}>
          <p {...stylex.attrs(controls.alertError)}>{error()}</p>
        </Show>

        <div {...stylex.attrs(styles.actionBar)}>
          <button
            type="button"
            disabled={selected().size === 0 || isActing()}
            onClick={handleDownloadZip}
            {...stylex.attrs(controls.button, controls.buttonPrimary, styles.packButton)}
          >
            <Package class={stylex.attrs(styles.packIcon).class} />
            {t('download.pack', { count: selected().size })}
          </button>
          <button
            type="button"
            onClick={() => load()}
            {...stylex.attrs(controls.button, controls.buttonOutline, actionButton.refresh)}
          >
            {t('common.refresh')}
          </button>
        </div>

        <div {...stylex.attrs(table.card)}>
          <Show
            when={!isLoading()}
            fallback={<p {...stylex.attrs(table.message)}>{t('common.loading')}</p>}
          >
            <Show
              when={items().length > 0}
              fallback={<p {...stylex.attrs(table.message)}>{t('download.empty')}</p>}
            >
              <table {...stylex.attrs(table.root)}>
                <thead>
                  <tr {...stylex.attrs(table.headRow)}>
                    <th {...stylex.attrs(table.thCheck)}>
                      <input
                        type="checkbox"
                        checked={items().length > 0 && selected().size === items().length}
                        onChange={(e) => toggleSelectAll(e.currentTarget.checked)}
                      />
                    </th>
                    <th {...stylex.attrs(table.th)}>{t('download.thTaskId')}</th>
                    <th {...stylex.attrs(table.th)}>{t('download.thStatus')}</th>
                    <th {...stylex.attrs(table.th)}>{t('download.thFiles')}</th>
                    <th {...stylex.attrs(table.th)}>{t('download.thCompletedAt')}</th>
                    <th {...stylex.attrs(table.th)}>{t('download.thActions')}</th>
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
                            checked={selected().has(task.taskId)}
                            onChange={(e) => toggleSelect(task.taskId, e.currentTarget.checked)}
                          />
                        </td>
                        <td {...stylex.attrs(table.td)}>
                          <Link
                            to={ROUTES.taskDetail(task.taskId)}
                            class={stylex.attrs(controls.link, table.link).class}
                          >
                            <code {...stylex.attrs(table.code)}>…{task.taskId.slice(-8)}</code>
                          </Link>
                        </td>
                        <td {...stylex.attrs(table.td)}>
                          <StatusBadge status={task.status} />
                        </td>
                        <td
                          {...stylex.attrs(table.truncate, table.truncateWide)}
                          title={task.fileNames.join(', ')}
                        >
                          {task.fileNames.join(', ')}
                        </td>
                        <td {...stylex.attrs(table.nowrap)}>
                          {formatDateTime(task.completedAt)}
                        </td>
                        <td {...stylex.attrs(table.td)}>
                          <button
                            type="button"
                            disabled={isActing()}
                            onClick={() => handleDownloadOne(task)}
                            {...stylex.attrs(styles.downloadButton)}
                          >
                            <Download class={stylex.attrs(styles.downloadIcon).class} />
                            {t('download.one')}
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
