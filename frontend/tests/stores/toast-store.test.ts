import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToastStore, TOAST_DISMISS_MS } from '../../src/stores/toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createToastStore', () => {
  it('starts empty', () => {
    const store = createToastStore();
    expect(store.toasts()).toEqual([]);
  });

  it('appends toasts with a default info variant and unique ids', () => {
    const store = createToastStore();

    const first = store.show('hello');
    const second = store.show('world', 'success');

    expect(first).not.toBe(second);
    expect(store.toasts()).toEqual([
      { id: first, variant: 'info', message: 'hello' },
      { id: second, variant: 'success', message: 'world' },
    ]);
  });

  it('dismiss removes a toast by id', () => {
    const store = createToastStore();
    const id = store.show('bye');

    store.dismiss(id);

    expect(store.toasts()).toEqual([]);
  });

  it('auto-dismisses after the configured delay', () => {
    const store = createToastStore();
    store.show('temporary');

    vi.advanceTimersByTime(TOAST_DISMISS_MS - 1);
    expect(store.toasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(store.toasts()).toEqual([]);
  });

  it('keeps other toasts when one auto-dismisses', () => {
    const store = createToastStore(1000);
    store.show('first', 'info');
    vi.advanceTimersByTime(500);
    store.show('second', 'error');

    vi.advanceTimersByTime(500);
    expect(store.toasts().map((t) => t.message)).toEqual(['second']);
  });
});
