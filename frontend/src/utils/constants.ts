import type { TaskStatus } from '@/api/schemas/tasks';

/**
 * Application route paths. Use these instead of hardcoding path strings
 * so renames stay compile-time safe.
 */
export const ROUTES = {
  home: '/',
  login: '/login',
  keyEntry: '/key',
  register: '/register',
  oauthCallback: '/oauth/callback',
  tasks: '/tasks',
  taskDetail: (id: string) => `/tasks/${id}`,
  upload: '/upload',
  apiKeys: '/api-keys',
  profile: '/profile',
  adminKeys: '/admin/keys',
  adminUsers: '/admin/users',
} as const;

/** Upstream repository, linked from the app footer. */
export const SOURCE_URL = 'https://github.com/mdrkrg/mineru-gateway';

/** Canonical AGPL-3.0 license text. */
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/** All task statuses in display order (mirrors `TaskStatus` union). */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'processing',
  'retry_pending',
  'completed',
  'partial',
  'failed',
  'cancelled',
];

/** Statuses that count as "in flight" (not yet in a terminal state). */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'processing',
  'retry_pending',
];

/** Whether a string is one of the known task statuses. */
export function isTaskStatus(status: string): status is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(status);
}

/** Whether a task status is still advancing (see {@link ACTIVE_TASK_STATUSES}). */
export function isActiveTaskStatus(status: string): boolean {
  return (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);
}

/** Polling interval (ms) for task list/detail views with in-flight tasks. */
export const TASK_POLL_INTERVAL_MS = 4000;

/** Polling interval (ms) for the dashboard statistics. */
export const STATS_POLL_INTERVAL_MS = 30000;
