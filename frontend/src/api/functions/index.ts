export {
  getHealth,
} from '@/api/functions/health';

export {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  login,
  refreshToken,
  logout,
  register,
  adminCreateUser,
  getCurrentUser,
  updateCurrentUser,
  listMyApiKeys,
  createMyApiKey,
  revokeMyApiKey,
  getOAuthProviders,
} from '@/api/functions/auth';

export {
  submitTask,
  parseFile,
  listTasks,
  getTaskStats,
  getTaskDetail,
  cancelTask,
  getTaskResult,
  downloadResultZip,
  batchCancelTasks,
} from '@/api/functions/tasks';

export type {
  TaskSubmissionOptions,
  FileParseOptions,
  TaskListParams,
} from '@/api/functions/tasks';
