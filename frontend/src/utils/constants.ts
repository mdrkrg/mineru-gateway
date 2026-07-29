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

/** Chinese display labels for task statuses (i18n will replace these). */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '排队中',
  processing: '处理中',
  retry_pending: '等待重试',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** Statuses that count as "in flight" (not yet in a terminal state). */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'processing',
  'retry_pending',
];
