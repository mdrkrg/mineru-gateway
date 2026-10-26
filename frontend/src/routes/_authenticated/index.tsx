import * as stylex from '@stylexjs/stylex';
import { Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { Popover } from '@kobalte/core/popover';
import { Upload } from 'lucide-solid';
import { getTaskStats } from '@/api/functions/tasks';
import type { TaskStatsResponse, TaskStatus } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import { t } from '@/i18n';
import { taskStatusLabel } from '@/i18n/labels';
import { useApiKey } from '@/stores/api-key-context';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';
import { ROUTES, STATS_POLL_INTERVAL_MS } from '@/utils/constants';
import { formatFileSize, formatMilliseconds } from '@/utils/format';
import { createPolling } from '@/utils/polling';
import { controls } from '@/styles/controls.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import {
  breakpoint,
  colors,
  fontSize,
  lineHeight,
  radius,
  shadow,
  space,
} from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/')({
  component: DashboardPage,
});

interface StatCard {
  label: string;
  value: string;
  hint?: string;
}

const styles = stylex.create({
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [breakpoint.sm]: 'repeat(3, minmax(0, 1fr))',
    },
    gap: space.px12,
  },
  overviewGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoint.lg]: 'repeat(4, minmax(0, 1fr))',
    },
    gap: space.px12,
  },
  statCard: {
    padding: space.px16,
  },
  statValue: {
    fontSize: fontSize.px24,
    lineHeight: lineHeight.px32,
    fontWeight: 700,
  },
  headingReset: {
    marginBottom: 0,
  },
  statHint: {
    marginTop: space.px4,
  },
  failedBadge: {
    borderRadius: radius.px4,
    paddingInline: space.px6,
    color: colors.red700,
    backgroundColor: colors.red50,
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    fontWeight: 600,
  },
  statusPopover: {
    zIndex: 10,
    width: space.px224,
    padding: space.px16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.gray200,
    borderRadius: radius.px8,
    boxShadow: shadow.lg,
    outlineStyle: 'none',
  },
  statusList: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px8,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.px16,
  },
  statusCount: {
    fontWeight: 600,
  },
});

function DashboardPage() {
  const auth = useAuth();
  const apiKeyStore = useApiKey();

  const [stats, setStats] = createSignal<TaskStatsResponse | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

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
    const result = await getTaskStats(key);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      setStats(result.value);
    }
    if (!opts.silent) setIsLoading(false);
    polling.start();
  }

  // Keep dashboard counts reasonably fresh without a manual reload; the
  // poller stops when the active API key is cleared.
  const polling = createPolling(() => load({ silent: true }), STATS_POLL_INTERVAL_MS);

  onMount(() => load());

  const statusCards = (): StatCard[] => {
    const s = stats();
    if (!s) return [];
    return [
      {
        label: taskStatusLabel('pending'),
        value: String(s.pending),
      },
      {
        label: taskStatusLabel('processing'),
        value: String(s.processing + s.retryPending),
        hint:
          s.retryPending > 0
            ? t('dashboard.retryPendingHint', { count: s.retryPending })
            : undefined,
      },
      {
        label: t('dashboard.resultsAvailable'),
        value: String(s.completed + s.partial),
        hint:
          s.partial > 0
            ? t('dashboard.partialHint', { count: s.partial })
            : undefined,
      },
    ];
  };

  const detailedStatuses = (): [TaskStatus, number][] => {
    const s = stats();
    if (!s) return [];
    return [
      ['pending', s.pending],
      ['processing', s.processing],
      ['retry_pending', s.retryPending],
      ['completed', s.completed],
      ['partial', s.partial],
      ['failed', s.failed],
      ['cancelled', s.cancelled],
    ];
  };

  const overviewCards = (): StatCard[] => {
    const s = stats();
    if (!s) return [];
    return [
      { label: t('dashboard.todayCompleted'), value: String(s.todayCompleted) },
      { label: t('dashboard.todayFailed'), value: String(s.todayFailed) },
      { label: t('dashboard.totalBytes'), value: formatFileSize(s.totalBytes) },
      {
        label: t('dashboard.avgDuration'),
        value: s.avgDurationMs !== null ? formatMilliseconds(s.avgDurationMs) : '—',
      },
    ];
  };

  return (
    <div {...stylex.attrs(layout.stack24, layout.pageWidth1024)}>
      <div {...stylex.attrs(layout.rowBetween)}>
        <h2 {...stylex.attrs(typography.pageTitle)}>
          {t('dashboard.welcome', {
            name: auth.user()?.displayName || auth.user()?.email || '',
          })}
        </h2>
        <Link
          to={ROUTES.upload}
          class={
            stylex.attrs(controls.button, controls.buttonPrimary).class
          }
        >
          <Upload class={stylex.attrs(icons.sm).class} />
          {t('nav.upload')}
        </Link>
      </div>

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

          <Show when={stats()}>
            <section {...stylex.attrs(layout.column)}>
              <div {...stylex.attrs(layout.rowBetween, layout.mb8)}>
                <h3
                  {...stylex.attrs(typography.subsectionTitle, styles.headingReset)}
                >
                  {t('dashboard.statusSection')}
                </h3>
                <Popover placement="bottom-end" gutter={8}>
                  <Popover.Trigger
                    type="button"
                    class={stylex.attrs(controls.button, controls.buttonOutline).class}
                  >
                    {t('dashboard.allStatuses')}
                    <Show when={(stats()?.failed ?? 0) > 0}>
                      <span class={stylex.attrs(styles.failedBadge).class}>
                        {t('dashboard.failedBadge', {
                          count: stats()?.failed ?? 0,
                        })}
                      </span>
                    </Show>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content class={stylex.attrs(styles.statusPopover).class}>
                      <Popover.Title
                        class={stylex.attrs(
                          typography.body,
                          typography.emphasis,
                          layout.mb12,
                        ).class}
                      >
                        {t('dashboard.allStatuses')}
                      </Popover.Title>
                      <div {...stylex.attrs(styles.statusList)}>
                        {detailedStatuses().map(([status, count]) => (
                          <div {...stylex.attrs(styles.statusRow)}>
                            <span {...stylex.attrs(typography.bodySecondary)}>
                              {taskStatusLabel(status)}
                            </span>
                            <span
                              {...stylex.attrs(typography.body, styles.statusCount)}
                            >
                              {count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover>
              </div>
              <div {...stylex.attrs(styles.statusGrid)}>
                {statusCards().map((card) => (
                  <div {...stylex.attrs(controls.card, styles.statCard)}>
                    <p {...stylex.attrs(typography.metaMuted, layout.mb4)}>
                      {card.label}
                    </p>
                    <p {...stylex.attrs(styles.statValue)}>{card.value}</p>
                    <Show when={card.hint}>
                      {(hint) => (
                        <p
                          {...stylex.attrs(typography.metaMuted, styles.statHint)}
                        >
                          {hint()}
                        </p>
                      )}
                    </Show>
                  </div>
                ))}
              </div>
            </section>

            <section {...stylex.attrs(layout.column)}>
              <h3 {...stylex.attrs(typography.subsectionTitle)}>
                {t('dashboard.overviewSection')}
              </h3>
              <div {...stylex.attrs(styles.overviewGrid)}>
                {overviewCards().map((card) => (
                  <div {...stylex.attrs(controls.card, styles.statCard)}>
                    <p {...stylex.attrs(typography.metaMuted, layout.mb4)}>
                      {card.label}
                    </p>
                    <p {...stylex.attrs(styles.statValue)}>{card.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <p {...stylex.attrs(typography.bodyMuted)}>
              {t('dashboard.footerPrefix')}
              <Link
                to={ROUTES.tasks}
                class={stylex.attrs(controls.link, typography.body).class}
              >
                {t('dashboard.tasksLink')}
              </Link>
              {t('dashboard.footerSuffix')}
            </p>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
