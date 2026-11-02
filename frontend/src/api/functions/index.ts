export {
  getHealth,
} from '@/api/functions/health';

export {
  getGatewayConfig,
} from '@/api/functions/config';

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
  requestVerifyToken,
} from '@/api/functions/auth';

export {
  submitTask,
  parseFile,
  listTasks,
  getTaskStats,
  getTaskDetail,
  cancelTask,
  downloadTaskResult,
  getRawTaskResult,
  downloadResultZip,
  batchCancelTasks,
} from '@/api/functions/tasks';

export type {
  TaskSubmissionOptions,
  FileParseOptions,
  TaskListParams,
} from '@/api/functions/tasks';
