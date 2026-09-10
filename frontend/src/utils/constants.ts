import type { TaskStatus } from '@/api/schemas/tasks';

/**
 * Application route paths. Use these instead of hardcoding path strings
 * so renames stay compile-time safe.
 */
export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  oauthCallback: '/oauth/callback',
  tasks: '/tasks',
  taskDetail: (id: string) => `/tasks/${id}`,
  upload: '/upload',
  download: '/download',
  apiKeys: '/api-keys',
  profile: '/profile',
  adminKeys: '/admin/keys',
  adminUsers: '/admin/users',
} as const;

/** All task statuses in display order (mirrors `TaskStatus` union). */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'processing',
  'retry_pending',
  'completed',
  'failed',
  'cancelled',
];

/** Statuses that count as "in flight" (not yet in a terminal state). */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'processing',
  'retry_pending',
];
