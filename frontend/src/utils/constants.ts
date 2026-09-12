import type { TaskStatus } from '@/api/schemas/tasks';
import type { MineruLanguage } from '@/api/schemas/mineru-options';

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

/** Whether a task status is still advancing (see {@link ACTIVE_TASK_STATUSES}). */
export function isActiveTaskStatus(status: string): boolean {
  return (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);
}

/** Polling interval (ms) for task list/detail views with in-flight tasks. */
export const TASK_POLL_INTERVAL_MS = 4000;

/** Polling interval (ms) for the dashboard statistics. */
export const STATS_POLL_INTERVAL_MS = 30000;

/** Chinese display labels for MinerU language codes（i18n will replace these）. */
export const MINERU_LANGUAGE_LABELS: Record<MineruLanguage, string> = {
  ch: '中文',
  ch_server: '中文服务端版',
  korean: '韩文',
  ta: '泰米尔文',
  te: '泰卢固文',
  ka: '卡纳达文',
  th: '泰文',
  el: '希腊文',
  arabic: '阿拉伯语系',
  east_slavic: '东斯拉夫语系',
  cyrillic: '西里尔语系',
  devanagari: '天城文语系',
};

/** Coverage description for each MinerU language code. */
export const MINERU_LANGUAGE_COVERAGE: Record<MineruLanguage, string> = {
  ch: '中文、英文、日文、繁体中文、拉丁文',
  ch_server: '中文、英文、日文、繁体中文、拉丁文（准确率更高/消耗更多资源）',
  korean: '韩文、英文',
  ta: '泰米尔文、英文',
  te: '泰卢固文、英文',
  ka: '卡纳达文',
  th: '泰文、英文',
  el: '希腊文、英文',
  arabic: '阿拉伯语、波斯语、维吾尔语、乌尔都语、普什图语、库尔德语、信德语、俾路支语、英文',
  east_slavic: '俄语、白俄罗斯语、乌克兰语、英文',
  cyrillic: '俄/白俄/乌克兰/塞尔维亚/保加利亚/蒙古/哈萨克/吉尔吉斯/塔吉克等 30+ 种使用西里尔字母的语言、英文',
  devanagari: '印地语、马拉地语、尼泊尔语、比哈里语、迈蒂利语、梵语等 14 种使用天城文的语言、英文',
};
