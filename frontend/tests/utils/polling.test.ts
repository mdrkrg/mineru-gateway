import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolling } from '../../src/utils/polling';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function stubVisibility(): { hide: () => void; show: () => void; restore: () => void } {
  let state: 'visible' | 'hidden' = 'visible';
  const listeners = new Set<() => void>();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get visibilityState() {
        return state;
      },
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    },
  });
  return {
    hide: () => {
      state = 'hidden';
    },
    show: () => {
      state = 'visible';
      listeners.forEach((fn) => fn());
    },
    restore: () => {
      Reflect.deleteProperty(globalThis, 'document');
    },
  };
}

describe('createPolling', () => {
  it('invokes tick on each interval once started', () => {
    const tick = vi.fn();
    const polling = createRoot(() => createPolling(tick, 1000));

    polling.start();
    vi.advanceTimersByTime(3000);

    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('is not running until started', () => {
    const polling = createRoot(() => createPolling(() => {}, 1000));
    expect(polling.isRunning()).toBe(false);
  });

  it('start is idempotent', () => {
    const tick = vi.fn();
    const polling = createRoot(() => createPolling(tick, 1000));

    polling.start();
    polling.start();
    vi.advanceTimersByTime(2000);

    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('stop halts subsequent ticks', () => {
    const tick = vi.fn();
    const polling = createRoot(() => createPolling(tick, 1000));

    polling.start();
    vi.advanceTimersByTime(1000);
    polling.stop();
    vi.advanceTimersByTime(2000);

    expect(tick).toHaveBeenCalledTimes(1);
    expect(polling.isRunning()).toBe(false);
  });

  it('clears the timer when the owning scope is disposed', () => {
    const tick = vi.fn();
    const { polling, dispose } = createRoot((dispose) => {
      const polling = createPolling(tick, 1000);
      polling.start();
      return { polling, dispose };
    });

    vi.advanceTimersByTime(1000);
    dispose();
    vi.advanceTimersByTime(3000);

    expect(tick).toHaveBeenCalledTimes(1);
    expect(polling.isRunning()).toBe(false);
  });

  it('cannot be restarted after the owning scope is disposed', () => {
    const tick = vi.fn();
    const { polling, dispose } = createRoot((dispose) => {
      const polling = createPolling(tick, 1000);
      return { polling, dispose };
    });

    dispose();

    // An in-flight load resolving after unmount may still call start(); it
    // must not resurrect the interval.
    polling.start();
    vi.advanceTimersByTime(3000);

    expect(tick).not.toHaveBeenCalled();
    expect(polling.isRunning()).toBe(false);
  });

  it('skips a tick while the previous async tick is still in flight', async () => {
    let resolveTick!: () => void;
    const tick = vi.fn(
      () => new Promise<void>((resolve) => { resolveTick = resolve; }),
    );
    const polling = createRoot(() => createPolling(tick, 1000));

    polling.start();
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(1);

    resolveTick();
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('skips ticks in a hidden tab and refreshes when it is shown again', () => {
    const visibility = stubVisibility();
    try {
      const tick = vi.fn();
      const polling = createRoot(() => createPolling(tick, 1000));
      polling.start();

      visibility.hide();
      vi.advanceTimersByTime(3000);
      expect(tick).not.toHaveBeenCalled();

      visibility.show();
      expect(tick).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      visibility.restore();
    }
  });

  it('stops listening for visibility changes once stopped', () => {
    const visibility = stubVisibility();
    try {
      const tick = vi.fn();
      const polling = createRoot(() => createPolling(tick, 1000));
      polling.start();
      polling.stop();

      visibility.hide();
      visibility.show();
      expect(tick).not.toHaveBeenCalled();
    } finally {
      visibility.restore();
    }
  });
});
