/**
 * Task actions shared by the list and the detail page.
 *
 * The pages own their own state signals; these helpers own the interaction
 * sequence so the confirm copy, the API call, the toast and the refresh stay
 * identical wherever a task is cancelled.
 */
import type { ConfirmStore } from '@/stores/confirm';
import type { ToastStore } from '@/stores/toast';
import { cancelTask } from '@/api/functions/tasks';
import type { NonDownloadableError } from '@/api/schemas/tasks';
import { t } from '@/i18n';
import { errorMessage } from '@/utils/api-error';
import { shortTaskId } from '@/utils/format';

export interface CancelTaskOptions {
  confirm: ConfirmStore;
  toast: ToastStore;
  taskId: string;
  /** Dialog description; title and confirm label are shared by both pages. */
  description: string;
  setError: (message: string | null) => void;
  setActing: (acting: boolean) => void;
  /** Silent refresh, so the page stays mounted while the status flips. */
  reload: () => Promise<void>;
}

/**
 * Confirm, cancel and report a task cancellation.
 *
 * Returns `true` when the user confirmed, so callers can clear a selection
 * that the silent reload deliberately keeps.
 */
export async function runTaskCancel(options: CancelTaskOptions): Promise<boolean> {
  const confirmed = await options.confirm.ask({
    title: t('tasks.confirmCancelTitle'),
    description: options.description,
    confirmText: t('taskDetail.cancel'),
    variant: 'danger',
  });
  if (!confirmed) return false;

  options.setActing(true);
  options.setError(null);
  try {
    const result = await cancelTask(options.taskId);
    if (result.isErr()) {
      options.setError(errorMessage(result.error));
    } else {
      options.toast.show(t('tasks.cancelledToast'), 'success');
    }
    await options.reload();
  } finally {
    options.setActing(false);
  }
  return true;
}

/**
 * User-facing message for a 409 result-ZIP response.
 *
 * Names the rejected tasks when the gateway lists them, falls back to its
 * `detail`, then to a generic reason so the message is never empty.
 */
export function nonDownloadableMessage(error: NonDownloadableError): string {
  const failed = error.nonDownloadable
    .map((item) => `…${shortTaskId(item.taskId)}(${item.reason})`)
    .join(t('common.listSeparator'));
  return t('tasks.notDownloadable', {
    failed: failed || error.detail || t('tasks.unknownReason'),
  });
}
