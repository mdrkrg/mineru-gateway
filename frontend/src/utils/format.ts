/**
 * Display formatting helpers: dates, file sizes, durations.
 * All functions are pure and never throw on bad input.
 *
 * Duration units are localized via the i18n dictionary.
 */
import { t } from '@/i18n';

/** Placeholder shown when a value is missing. */
export const EMPTY_PLACEHOLDER = '—';

/** Zero-pads a number to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Parses an ISO timestamp; `null` for missing or unparseable input. */
function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats an ISO 8601 timestamp as a local date-time string
 * (`YYYY-MM-DD HH:mm:ss`). Returns the placeholder for null/undefined
 * or unparseable input.
 */
export function formatDateTime(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) return EMPTY_PLACEHOLDER;
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/**
 * Formats a timestamp for dense task lists without the seconds/year noise.
 *
 * - Today: `HH:mm`
 * - Same year: `MM-DD HH:mm`
 * - Older: `YYYY-MM-DD`
 *
 * `now` is injectable so tests do not depend on the wall clock. Local time is
 * used, matching {@link formatDateTime}.
 */
export function formatCompactDateTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseIso(iso);
  if (!date) return EMPTY_PLACEHOLDER;

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return time;

  const monthDay = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (date.getFullYear() === now.getFullYear()) return `${monthDay} ${time}`;
  return `${date.getFullYear()}-${monthDay}`;
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
  if (hours > 0) parts.push(t('format.hourShort', { n: hours }));
  if (minutes > 0) parts.push(t('format.minuteShort', { n: minutes }));
  if (seconds > 0 || parts.length === 0) parts.push(t('format.secondShort', { n: seconds }));
  return parts.join(' ');
}

/**
 * Formats the elapsed time between two ISO timestamps.
 * When `endIso` is null/undefined, measures up to `now` (defaults to
 * the current time). Returns a locale-formatted duration such as
 * `"1h 2m 3s"` or `"45s"`.
 * Returns the placeholder when input is unparseable or negative.
 */
export function formatDuration(
  startIso: string,
  endIso?: string | null,
  now?: Date,
): string {
  const start = parseIso(startIso)?.getTime();
  const end = endIso ? parseIso(endIso)?.getTime() : (now ?? new Date()).getTime();
  if (start === undefined || end === undefined) return EMPTY_PLACEHOLDER;
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

/**
 * Last 8 characters of a task UUID, used as a human-readable suffix.
 *
 * UUIDv7 starts with a timestamp, so task prefixes cluster together; the
 * suffix is the random part and is the useful part to show in a list.
 * The full UUID remains the canonical identifier.
 */
export function shortTaskId(taskId: string): string {
  return taskId.slice(-8);
}

/**
 * `#xxxxxxxx` reference for a task UUID, as shown in list meta rows and
 * confirmation dialogs. See {@link shortTaskId} for why the suffix is used.
 */
export function taskIdRef(taskId: string): string {
  return `#${shortTaskId(taskId)}`;
}
