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

/**
 * Interval-based poller for refreshing async task state.
 *
 * `tick` is invoked every `intervalMs` milliseconds. Async ticks are not
 * awaited, but a new tick is skipped while the previous one is still running
 * so slow requests cannot pile up. The returned handle must be created within
 * a reactive owner: it registers an `onCleanup` that marks the poller as
 * disposed and stops the timer, so an in-flight tick resolving after unmount
 * cannot restart it.
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

  const start = () => {
    if (disposed || timer !== null) return;
    timer = setInterval(() => {
      if (inFlight) return;
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
    }, intervalMs);
  };

  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  onCleanup(() => {
    disposed = true;
    stop();
  });

  return { start, stop, isRunning: () => timer !== null };
}
