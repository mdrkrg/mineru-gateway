import {
  isHttpError,
  isNetworkError,
  isUnhandledStatusError,
  isUnexpectedError,
  isValidationError,
} from '@/core/error-model';
import type { ApiErrorBase, HttpError } from '@/core/error-model';
import { t } from '@/i18n';

/**
 * Maps an API error to a human-readable message for display.
 * Shared by the auth store and form pages (register, etc.).
 * Fallback error strings are localized; raw upstream details pass through.
 */
export function errorMessage(error: ApiErrorBase | HttpError<number, unknown>): string {
  if (isHttpError(error)) {
    const data = error.data as { detail?: string } | undefined;
    return t('errors.httpDetail', {
      status: error.status,
      detail: data?.detail ?? t('errors.unknown'),
    });
  }
  if (isNetworkError(error)) return error.error?.message ?? t('errors.network');
  if (isValidationError(error)) return error.summary ?? t('errors.validation');
  if (isUnhandledStatusError(error)) return t('errors.unexpectedStatus', { status: error.status });
  if (isUnexpectedError(error)) return t('errors.unexpected');
  return t('errors.unknown');
}
