import {
  isHttpError,
  isNetworkError,
  isUnhandledStatusError,
  isUnexpectedError,
  isValidationError,
} from '../core/error-model';
import type { ApiErrorBase, HttpError } from '../core/error-model';

/**
 * Maps an API error to a human-readable Chinese message for display.
 * Shared by the auth store and form pages (register, etc.).
 */
export function errorMessage(error: ApiErrorBase | HttpError<number, unknown>): string {
  if (isHttpError(error)) {
    const data = error.data as { detail?: string } | undefined;
    return `HTTP ${error.status}: ${data?.detail ?? 'unknown'}`;
  }
  if (isNetworkError(error)) return error.error?.message ?? 'Network error';
  if (isValidationError(error)) return error.summary ?? 'Validation error';
  if (isUnhandledStatusError(error)) return `Unexpected status ${error.status}`;
  if (isUnexpectedError(error)) return 'Unexpected error';
  return 'Unknown error';
}
