/**
 * Browser download helpers for blob responses.
 */

import type { ResultAsync } from 'neverthrow';
import type { ApiError, HttpError } from '@/core/error-model';
import type { BlobResult } from '@/core/http-client';
import { errorMessage } from '@/utils/api-error';

/**
 * Extracts a filename from a Content-Disposition header value.
 * Handles both `filename="..."` and RFC 5987 `filename*=UTF-8''...` forms.
 * Returns null when no filename is present.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  const star = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }

  const plain = /filename="?([^";]+)"?/.exec(header);
  if (plain) return plain[1].trim();

  return null;
}

/**
 * Returns the appropriate file extension based on the Content-Type
 * response header. Used as fallback when Content-Disposition has no
 * filename or the upstream returns a misleading extension.
 *
 * - missing Content-Type -> `.bin`
 * - `application/json` -> `.json`
 * - `application/zip` -> `.zip`
 * - anything else -> `.bin`
 */
export function extensionFromContentType(contentType: string | null): string {
  if (!contentType) return '.bin';
  if (contentType.includes('application/json')) return '.json';
  if (contentType.includes('application/zip')) return '.zip';
  if (contentType.includes('text/markdown')) return '.md';
  if (contentType.includes('text/plain')) return '.txt';
  return '.bin';
}

/** Extensionless basename of the first uploaded file, when known. */
function firstFileStem(fileNames: readonly string[]): string | null {
  const first = fileNames[0];
  if (!first) return null;
  const base = first.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim();
  return stem || null;
}

/**
 * Filename fallback for downloads that carry no Content-Disposition: reuse the
 * original file name so the browser never saves a task UUID.
 */
export function fallbackFilename(
  fileNames: readonly string[],
  contentType: string | null,
): string {
  const stem = firstFileStem(fileNames);
  return `${stem ?? 'result'}${extensionFromContentType(contentType)}`;
}

/** Content-Disposition filename first, original file name as the fallback. */
export function resultFilename(
  headers: Headers,
  fileNames: readonly string[],
): string {
  return (
    filenameFromContentDisposition(headers.get('Content-Disposition')) ??
    fallbackFilename(fileNames, headers.get('Content-Type'))
  );
}

/**
 * Triggers a browser "save as" download for a blob.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Fetches a task result as a blob: `downloadTaskResult` / `getRawTaskResult`. */
export type ResultFetcher = (
  taskId: string,
  apiKey: string,
) => ResultAsync<BlobResult, ApiError<HttpError<number, unknown>>>;

/**
 * Fetch a task result and save it under a friendly name.
 * Returns the user-facing error message, or null when the download succeeded.
 */
export async function downloadResultFile(
  fetchResult: ResultFetcher,
  taskId: string,
  apiKey: string,
  fileNames: readonly string[],
): Promise<string | null> {
  const result = await fetchResult(taskId, apiKey);
  if (result.isErr()) return errorMessage(result.error);
  saveBlob(result.value.blob, resultFilename(result.value.headers, fileNames));
  return null;
}
