/**
 * Display formatting helpers: dates, file sizes, durations.
 * All functions are pure and never throw on bad input.
 */

/** Placeholder shown when a value is missing. */
export const EMPTY_PLACEHOLDER = '—';

/**
 * Formats an ISO 8601 timestamp as a local date-time string
 * (`YYYY-MM-DD HH:mm:ss`). Returns the placeholder for null/undefined
 * or unparseable input.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY_PLACEHOLDER;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_PLACEHOLDER;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * Formats a byte count using binary units (B, KB, MB, GB, TB).
 * Negative or non-finite input yields the placeholder.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return EMPTY_PLACEHOLDER;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

function composeDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);
  return parts.join(' ');
}

/**
 * Formats the elapsed time between two ISO timestamps.
 * When `endIso` is null/undefined, measures up to `now` (defaults to
 * the current time). Returns e.g. `"1小时 2分 3秒"`, `"45秒"`.
 * Returns the placeholder when input is unparseable or negative.
 */
export function formatDuration(
  startIso: string,
  endIso?: string | null,
  now?: Date,
): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : (now ?? new Date()).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return EMPTY_PLACEHOLDER;
  const ms = end - start;
  if (ms < 0) return EMPTY_PLACEHOLDER;
  return composeDuration(Math.floor(ms / 1000));
}

/**
 * Formats a millisecond count as a duration string (same style as
 * {@link formatDuration}). Returns the placeholder for negative or
 * non-finite input.
 */
export function formatMilliseconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return EMPTY_PLACEHOLDER;
  return composeDuration(Math.floor(ms / 1000));
}
