import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolling } from '../../src/utils/polling';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

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
});
