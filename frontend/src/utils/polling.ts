import { onCleanup } from 'solid-js';

/** Handle for a started/stopped interval-based poller. */
export interface Polling {
  /** Begin polling; no-op when already running. */
  start: () => void;
  /** Stop polling; safe to call when not running. */
  stop: () => void;
  /** Whether the poller currently has an active timer. */
  isRunning: () => boolean;
}

/** A background tab cannot show the result, so it does not poll. */
function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Interval-based poller for refreshing async task state.
 *
 * - Ticks run every `intervalMs` while the tab is visible. A hidden tab skips
 *   its ticks, then refreshes once when it becomes visible again.
 * - Ticks are not awaited. A new one is skipped while the previous one is still
 *   in flight, so slow requests cannot pile up.
 * - Must be created inside a reactive owner. `onCleanup` stops the timer, so an
 *   in-flight tick resolving after unmount cannot restart it.
 *
 * @example
 * const polling = createPolling(() => load(page(), { silent: true }), 4000);
 * // after each load: polling.start() when active tasks exist, else polling.stop()
 */
export function createPolling(
  tick: () => void | Promise<void>,
  intervalMs: number,
): Polling {
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let inFlight = false;

  const run = () => {
    if (disposed || inFlight || isHidden()) return;
    let result: void | Promise<void>;
    try {
      result = tick();
    } catch {
      return;
    }
    if (result instanceof Promise) {
      inFlight = true;
      void Promise.resolve(result)
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }
  };

  const onVisibilityChange = () => {
    if (!isHidden()) run();
  };

  const start = () => {
    if (disposed || timer !== null) return;
    timer = setInterval(run, intervalMs);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  };

  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };

  onCleanup(() => {
    disposed = true;
    stop();
  });

  return { start, stop, isRunning: () => timer !== null };
}
