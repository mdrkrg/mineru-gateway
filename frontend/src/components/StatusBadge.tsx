import * as stylex from '@stylexjs/stylex';
import type { TaskStatus } from '@/api/schemas/tasks';
import { taskStatusLabel } from '@/i18n/labels';
import { TASK_STATUSES } from '@/utils/constants';
import { badges } from '@/styles/badges.stylex';

const STATUS_STYLES: Record<TaskStatus, stylex.StyleXStyles> = {
  pending: badges.pending,
  processing: badges.blue,
  retry_pending: badges.retryPending,
  completed: badges.green,
  failed: badges.failed,
  cancelled: badges.gray,
};

/** Colored pill showing a task status label. Tolerates unknown statuses. */
export default function StatusBadge(props: { status: string }) {
  const style = () => STATUS_STYLES[props.status as TaskStatus] ?? badges.fallback;
  const isKnown = () => (TASK_STATUSES as readonly string[]).includes(props.status);
  const label = () => (isKnown() ? taskStatusLabel(props.status as TaskStatus) : props.status);
  return <span {...stylex.attrs(badges.pill, style())}>{label()}</span>;
}
