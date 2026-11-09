import * as stylex from '@stylexjs/stylex';
import { Show } from 'solid-js';
import type { TaskStatus } from '@/api/schemas/tasks';
import { taskStatusLabel, taskStatusShortLabel } from '@/i18n/labels';
import { isTaskStatus } from '@/utils/constants';
import { badges } from '@/styles/badges.stylex';
import { colors, fontSize, lineHeight, space } from '@/styles/tokens.stylex';

const styles = stylex.create({
  compact: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.px4,
    color: colors.gray600,
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    whiteSpace: 'nowrap',
  },
});

/**
 * Pill and dot share one row per status, so the two renderings of a status
 * cannot drift apart.
 */
const STATUS_VISUALS: Record<
  TaskStatus,
  { pill: stylex.StyleXStyles; dot: stylex.StyleXStyles }
> = {
  pending: { pill: badges.pending, dot: badges.dotYellow },
  processing: { pill: badges.blue, dot: badges.dotBlue },
  retry_pending: { pill: badges.retryPending, dot: badges.dotOrange },
  completed: { pill: badges.green, dot: badges.dotGreen },
  partial: { pill: badges.retryPending, dot: badges.dotOrange },
  failed: { pill: badges.failed, dot: badges.dotRed },
  cancelled: { pill: badges.gray, dot: badges.dotGray },
};

/** Unknown status strings (older or newer gateways) stay a neutral grey. */
const FALLBACK_VISUALS = { pill: badges.fallback, dot: badges.dotGray };

/** Colored status pill, or a compact dot + short label for dense lists. */
export default function StatusBadge(props: {
  status: string;
  compact?: boolean;
}) {
  const known = () => (isTaskStatus(props.status) ? props.status : null);
  const visuals = () => {
    const status = known();
    return status ? STATUS_VISUALS[status] : FALLBACK_VISUALS;
  };
  const label = () => {
    const status = known();
    return status ? taskStatusLabel(status) : props.status;
  };
  const shortLabel = () => {
    const status = known();
    return status ? taskStatusShortLabel(status) : props.status;
  };

  return (
    <Show
      when={props.compact}
      fallback={
        <span {...stylex.attrs(badges.pill, visuals().pill)}>{label()}</span>
      }
    >
      <span {...stylex.attrs(styles.compact)}>
        <span
          aria-hidden="true"
          {...stylex.attrs(badges.dotBase, visuals().dot)}
        />
        {shortLabel()}
      </span>
    </Show>
  );
}
