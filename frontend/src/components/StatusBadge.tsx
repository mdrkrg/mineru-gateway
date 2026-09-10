import type { TaskStatus } from '@/api/schemas/tasks';
import { taskStatusLabel } from '@/i18n/labels';
import { TASK_STATUSES } from '@/utils/constants';

const COLORS: Record<TaskStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  retry_pending: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const FALLBACK = 'bg-gray-100 text-gray-600';

/** Colored pill showing a task status label. Tolerates unknown statuses. */
export default function StatusBadge(props: { status: string }) {
  const color = () => COLORS[props.status as TaskStatus] ?? FALLBACK;
  const isKnown = () => (TASK_STATUSES as readonly string[]).includes(props.status);
  const label = () => (isKnown() ? taskStatusLabel(props.status as TaskStatus) : props.status);
  return (
    <span class={`inline-block text-xs rounded px-1.5 py-0.5 whitespace-nowrap ${color()}`}>
      {label()}
    </span>
  );
}
