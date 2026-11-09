import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from 'neverthrow';
import { createHttpError } from '../../src/core/error-model';
import { setLocale } from '../../src/i18n';
import { createConfirmStore } from '../../src/stores/confirm';
import { createToastStore } from '../../src/stores/toast';
import { nonDownloadableMessage, runTaskCancel } from '../../src/utils/task-actions';

const { cancelTask } = vi.hoisted(() => ({ cancelTask: vi.fn() }));

vi.mock('@/api/functions/tasks', () => ({ cancelTask }));

// Error messages come from the dictionary; pin the locale like the other util
// tests do.
beforeEach(() => {
  setLocale('zh-CN');
  cancelTask.mockReset();
});

function setup() {
  const confirm = createConfirmStore();
  const toast = createToastStore();
  const setError = vi.fn();
  const setActing = vi.fn();
  const reload = vi.fn(async () => {});

  const run = (answer: boolean) => {
    const pending = runTaskCancel({
      confirm,
      toast,
      taskId: 'task-1',
      description: 'desc',
      setError,
      setActing,
      reload,
    });
    confirm.resolve(answer);
    return pending;
  };

  return { toast, setError, setActing, reload, run };
}

describe('nonDownloadableMessage', () => {
  it('names the rejected tasks by short id and reason', () => {
    expect(
      nonDownloadableMessage({
        detail: 'nope',
        nonDownloadable: [
          {
            taskId: '01a19193-54a2-712c-9109-886b3fba7bba',
            status: 'failed',
            reason: 'no result',
          },
        ],
      }),
    ).toContain('…3fba7bba(no result)');
  });

  it('falls back to the gateway detail when no task is named', () => {
    expect(
      nonDownloadableMessage({ detail: 'boom', nonDownloadable: [] }),
    ).toContain('boom');
  });

  it('never renders an empty reason', () => {
    expect(
      nonDownloadableMessage({ detail: '', nonDownloadable: [] }),
    ).toContain('未知原因');
  });
});

describe('runTaskCancel', () => {
  it('stops at a declined confirmation', async () => {
    const { toast, setError, setActing, reload, run } = setup();

    await expect(run(false)).resolves.toBe(false);

    expect(cancelTask).not.toHaveBeenCalled();
    expect(setActing).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(toast.toasts()).toHaveLength(0);
  });

  it('cancels, toasts and reloads on success', async () => {
    cancelTask.mockResolvedValue(
      ok({ taskId: 'task-1', status: 'cancelled', message: 'ok' }),
    );
    const { toast, setError, setActing, reload, run } = setup();

    await expect(run(true)).resolves.toBe(true);

    expect(cancelTask).toHaveBeenCalledWith('task-1');
    expect(setActing.mock.calls).toEqual([[true], [false]]);
    expect(setError).toHaveBeenCalledWith(null);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast.toasts()).toHaveLength(1);
    expect(toast.toasts()[0]?.variant).toBe('success');
  });

  it('reports the error instead of toasting on failure', async () => {
    cancelTask.mockResolvedValue(err(createHttpError(409, { detail: 'boom' })));
    const { toast, setError, setActing, reload, run } = setup();

    await expect(run(true)).resolves.toBe(true);

    expect(setError).toHaveBeenNthCalledWith(1, null);
    expect(setError.mock.calls.at(-1)?.[0]).toEqual(expect.any(String));
    expect(toast.toasts()).toHaveLength(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(setActing).toHaveBeenLastCalledWith(false);
  });
});
