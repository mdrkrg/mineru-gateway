import * as stylex from '@stylexjs/stylex';
import type { TaskStatus } from '@/api/schemas/tasks';
import { taskStatusLabel } from '@/i18n/labels';
import { TASK_STATUSES } from '@/utils/constants';
import { colors, fontSize, lineHeight, radius, space } from '@/styles/tokens.stylex';

const styles = stylex.create({
  badge: {
    display: 'inline-block',
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    borderRadius: radius.px4,
    paddingInline: space.px6,
    paddingBlock: space.px2,
    whiteSpace: 'nowrap',
  },
  pending: {
    backgroundColor: colors.yellow100,
    color: colors.yellow700,
  },
  processing: {
    backgroundColor: colors.blue100,
    color: colors.blue700,
  },
  retryPending: {
    backgroundColor: colors.orange100,
    color: colors.orange700,
  },
  completed: {
    backgroundColor: colors.green100,
    color: colors.green700,
  },
  failed: {
    backgroundColor: colors.red100,
    color: colors.red700,
  },
  cancelled: {
    backgroundColor: colors.gray100,
    color: colors.gray500,
  },
  fallback: {
    backgroundColor: colors.gray100,
    color: colors.gray600,
  },
});

const STATUS_STYLES: Record<TaskStatus, stylex.StyleXStyles> = {
  pending: styles.pending,
  processing: styles.processing,
  retry_pending: styles.retryPending,
  completed: styles.completed,
  failed: styles.failed,
  cancelled: styles.cancelled,
};

/** Colored pill showing a task status label. Tolerates unknown statuses. */
export default function StatusBadge(props: { status: string }) {
  const style = () => STATUS_STYLES[props.status as TaskStatus] ?? styles.fallback;
  const isKnown = () => (TASK_STATUSES as readonly string[]).includes(props.status);
  const label = () => (isKnown() ? taskStatusLabel(props.status as TaskStatus) : props.status);
  return <span {...stylex.attrs(styles.badge, style())}>{label()}</span>;
}
