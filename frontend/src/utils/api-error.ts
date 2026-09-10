import {
  isHttpError,
  isNetworkError,
  isUnhandledStatusError,
  isUnexpectedError,
  isValidationError,
} from '@/core/error-model';
import type { ApiErrorBase, HttpError } from '@/core/error-model';
import { t, type DictKey } from '@/i18n';
import { formatFileSize } from './format';

/**
 * Known backend `detail` strings mapped to dictionary keys. Backend details
 * are stable, human-readable English from the gateway routes but not
 * end-user friendly.
 */
const DETAIL_KEYS: Record<string, DictKey> = {
  'Invalid credentials': 'errors.detail.invalidCredentials',
  'Invalid refresh token': 'errors.detail.invalidRefreshToken',
  'Not authenticated': 'errors.detail.notAuthenticated',
  'API key required': 'errors.detail.apiKeyRequired',
  'Invalid API key': 'errors.detail.invalidApiKey',
  'Invalid or missing admin token': 'errors.detail.invalidAdminToken',
  'Email not verified': 'errors.detail.emailNotVerified',
  'Password does not meet rules': 'errors.detail.passwordRules',
  'Email already registered': 'errors.detail.emailAlreadyRegistered',
  'Registration is closed': 'errors.detail.registrationClosed',
  'Key not found': 'errors.detail.keyNotFound',
  'Task not found': 'errors.detail.taskNotFound',
};

/** Generic fallbacks keyed by HTTP status. */
const STATUS_KEYS: Record<number, DictKey> = {
  400: 'errors.status.400',
  401: 'errors.status.401',
  403: 'errors.status.403',
  404: 'errors.status.404',
  409: 'errors.status.409',
  413: 'errors.status.413',
  422: 'errors.status.422',
  429: 'errors.status.429',
  500: 'errors.status.500',
  502: 'errors.status.502',
  503: 'errors.status.503',
  504: 'errors.status.504',
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
  const detailKey = detail ? DETAIL_KEYS[detail] : undefined;
  if (detailKey) return t(detailKey);
  if (status === 413) {
    const limit = uploadLimitFromDetail(detail);
    if (limit) return t('errors.uploadLimitWithSize', { limit });
  }
  const statusKey = STATUS_KEYS[status];
  if (statusKey) return t(statusKey);
  return t('errors.requestFailed', { status });
}

/**
 * Maps an API error to a human-readable message for display.
 * Shared by the auth store and form pages (register, etc.).
 *
 * Prefers a known backend `detail` when available, then falls back to a
 * generic message by status code, so users never see a raw `HTTP 4xx: ...`
 * string.
 */
export function errorMessage(error: ApiErrorBase | HttpError<number, unknown>): string {
  if (isHttpError(error)) return messageForStatus(error.status, error.data);
  if (isNetworkError(error)) return t('errors.network');
  if (isValidationError(error)) return t('errors.validation');
  if (isUnhandledStatusError(error)) return messageForStatus(error.status, error.data);
  if (isUnexpectedError(error)) return t('errors.unexpected');
  return t('errors.unexpected');
}
