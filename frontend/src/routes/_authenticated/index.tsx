import * as stylex from '@stylexjs/stylex';
import { Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { Upload } from 'lucide-solid';
import { getTaskStats } from '@/api/functions/tasks';
import type { TaskStatsResponse } from '@/api/schemas/tasks';
import NoActiveKey from '@/components/NoActiveKey';
import { t } from '@/i18n';
import { taskStatusLabel } from '@/i18n/labels';
import { useApiKey } from '@/stores/api-key-context';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';
import { ROUTES, STATS_POLL_INTERVAL_MS } from '@/utils/constants';
import { formatFileSize, formatMilliseconds } from '@/utils/format';
import { createPolling } from '@/utils/polling';
import type { TaskStatus } from '@/api/schemas/tasks';
import { controls } from '@/styles/controls.stylex';
import {
  breakpoint,
  colors,
  fontSize,
  lineHeight,
  maxWidth,
  space,
} from '@/styles/tokens.stylex';

export const Route = createFileRoute('/_authenticated/')({
  component: DashboardPage,
});

interface StatCard {
  label: string;
  value: string;
  hint?: string;
}

const styles = stylex.create({
  root: {
    maxWidth: maxWidth.px1024,
    display: 'flex',
    flexDirection: 'column',
    gap: space.px24,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    fontSize: fontSize.px20,
    lineHeight: lineHeight.px28,
    fontWeight: 700,
  },
  uploadButton: {
    gap: space.px6,
  },
  uploadIcon: {
    width: space.px16,
    height: space.px16,
  },
  loading: {
    color: colors.gray500,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
  },
  sectionTitle: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    fontWeight: 600,
    color: colors.gray500,
    marginBottom: space.px8,
  },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoint.sm]: 'repeat(3, minmax(0, 1fr))',
      [breakpoint.lg]: 'repeat(6, minmax(0, 1fr))',
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
  statLabel: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    color: colors.gray500,
    marginBottom: space.px4,
  },
  statValue: {
    fontSize: fontSize.px24,
    lineHeight: lineHeight.px32,
    fontWeight: 700,
  },
  footer: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
  },
  footerLink: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
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
    const byStatus: [TaskStatus, number][] = [
      ['pending', s.pending],
      ['processing', s.processing],
      ['retry_pending', s.retryPending],
      ['completed', s.completed],
      ['failed', s.failed],
      ['cancelled', s.cancelled],
    ];
    return byStatus.map(([status, count]) => ({
      label: taskStatusLabel(status),
      value: String(count),
    }));
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
    <div {...stylex.attrs(styles.root)}>
      <div {...stylex.attrs(styles.header)}>
        <h2 {...stylex.attrs(styles.heading)}>
          {t('dashboard.welcome', {
            name: auth.user()?.displayName || auth.user()?.email || '',
          })}
        </h2>
        <Link
          to={ROUTES.upload}
          class={
            stylex.attrs(controls.button, controls.buttonPrimary, styles.uploadButton).class
          }
        >
          <Upload class={stylex.attrs(styles.uploadIcon).class} />
          {t('nav.upload')}
        </Link>
      </div>

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

          <Show when={stats()}>
            <section {...stylex.attrs(styles.section)}>
              <h3 {...stylex.attrs(styles.sectionTitle)}>{t('dashboard.statusSection')}</h3>
              <div {...stylex.attrs(styles.statusGrid)}>
                {statusCards().map((card) => (
                  <div {...stylex.attrs(controls.card, styles.statCard)}>
                    <p {...stylex.attrs(styles.statLabel)}>{card.label}</p>
                    <p {...stylex.attrs(styles.statValue)}>{card.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section {...stylex.attrs(styles.section)}>
              <h3 {...stylex.attrs(styles.sectionTitle)}>{t('dashboard.overviewSection')}</h3>
              <div {...stylex.attrs(styles.overviewGrid)}>
                {overviewCards().map((card) => (
                  <div {...stylex.attrs(controls.card, styles.statCard)}>
                    <p {...stylex.attrs(styles.statLabel)}>{card.label}</p>
                    <p {...stylex.attrs(styles.statValue)}>{card.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <p {...stylex.attrs(styles.footer)}>
              {t('dashboard.footerPrefix')}
              <Link
                to={ROUTES.tasks}
                class={stylex.attrs(controls.link, styles.footerLink).class}
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
