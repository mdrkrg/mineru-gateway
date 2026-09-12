import {
  isHttpError,
  isNetworkError,
  isUnhandledStatusError,
  isUnexpectedError,
  isValidationError,
} from '@/core/error-model';
import type { ApiErrorBase, HttpError } from '@/core/error-model';
import { formatFileSize } from './format';

/**
 * Known backend `detail` strings mapped to actionable Chinese messages.
 * Backend details are stable, human-readable English from the gateway routes
 * but not end-user friendly.
 */
const DETAIL_MESSAGES: Record<string, string> = {
  'Invalid credentials': '邮箱或密码错误',
  'Invalid refresh token': '登录状态已失效，请重新登录',
  'Not authenticated': '登录状态已失效，请重新登录',
  'API key required': '请先在 API Keys 页面设置 API Key',
  'Invalid API key': 'API Key 无效或已被吊销，请在 API Keys 页面重新设置',
  'Invalid or missing admin token': '管理令牌无效，请重新输入',
  'Email not verified': '邮箱尚未验证，请先完成邮箱验证',
  'Password does not meet rules': '密码不符合要求（至少 8 位）',
  'Email already registered': '该邮箱已注册，请直接登录',
  'Registration is closed': '当前已关闭注册',
  'Key not found': 'API Key 不存在或已被吊销',
  'Task not found': '任务不存在或已被清理',
};

/** Generic fallbacks keyed by HTTP status. */
const STATUS_MESSAGES: Record<number, string> = {
  400: '请求参数有误，请检查后重试',
  401: '登录状态已失效，请重新登录',
  403: '没有权限执行该操作',
  404: '请求的资源不存在或已被清理',
  409: '操作与当前状态冲突，请刷新后重试',
  413: '上传内容超过大小上限',
  422: '提交的内容未通过校验，请检查后重试',
  429: '操作过于频繁，请稍后重试',
  500: '服务器内部错误，请稍后重试',
  502: '上游服务暂时不可用，请稍后重试',
  503: '服务繁忙，请稍后重试',
  504: '上游服务响应超时，请稍后重试',
};

/** Extracts a non-empty string `detail` from an arbitrary error body. */
function detailOf(data: unknown): string | null {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.length > 0) return detail;
  }
  return null;
}

/**
 * Extracts the byte limit from the gateway's 413 detail, e.g.
 * `Upload exceeds max size (524288000 bytes)`, so the user sees the actual
 * cap instead of a bare "too large".
 */
function uploadLimitFromDetail(detail: string | null): string | null {
  const match = detail?.match(/\((\d+)\s*bytes?\)/i);
  if (!match) return null;
  const bytes = Number(match[1]);
  return Number.isFinite(bytes) && bytes > 0 ? formatFileSize(bytes) : null;
}

/** Maps a status code (with optional body) to a user-facing message. */
function messageForStatus(status: number, data?: unknown): string {
  const detail = detailOf(data);
  if (detail && DETAIL_MESSAGES[detail]) return DETAIL_MESSAGES[detail];
  if (status === 413) {
    const limit = uploadLimitFromDetail(detail);
    if (limit) return `上传内容超过大小上限（${limit}）`;
  }
  return STATUS_MESSAGES[status] ?? `请求失败（HTTP ${status}）`;
}

/**
 * Maps an API error to a human-readable Chinese message for display.
 * Shared by the auth store and form pages (register, etc.).
 *
 * Prefers a known backend `detail` when available, then falls back to a
 * generic message by status code, so users never see a raw `HTTP 4xx: ...`
 * string.
 */
export function errorMessage(error: ApiErrorBase | HttpError<number, unknown>): string {
  if (isHttpError(error)) return messageForStatus(error.status, error.data);
  if (isNetworkError(error)) return '网络连接失败，请检查网络后重试';
  if (isValidationError(error)) return '响应数据格式异常，请稍后重试';
  if (isUnhandledStatusError(error)) return messageForStatus(error.status, error.data);
  if (isUnexpectedError(error)) return '发生未知错误，请重试';
  return '发生未知错误，请重试';
}
