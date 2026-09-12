import { t } from '@/i18n';
import { formatFileSize } from './format';

/** Result of a client-side upload-size pre-check. */
export type UploadSizeCheck =
  | { ok: true; totalBytes: number }
  | { ok: false; totalBytes: number; message: string };

/**
 * Pre-checks the selected files against the gateway's per-request upload
 * limit. This mirrors the gateway's `GATEWAY_MAX_UPLOAD_SIZE` (cumulative
 * request bytes) so the user gets immediate feedback instead of a 413 after
 * a long upload.
 *
 * A single file over the limit always implies the total is over the limit;
 * it is reported separately only to give a clearer message. The gateway is
 * still the source of truth.
 *
 * @param files - Files selected for one submission.
 * @param maxBytes - Maximum cumulative size per request, in bytes.
 */
export function validateUploadSize(
  files: readonly File[],
  maxBytes: number,
): UploadSizeCheck {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  const oversized = files.filter((file) => file.size > maxBytes);
  if (oversized.length > 0) {
    const names = oversized.map((file) => file.name).join(t('common.listSeparator'));
    return {
      ok: false,
      totalBytes,
      message: t('errors.uploadOversizedFiles', {
        limit: formatFileSize(maxBytes),
        names,
      }),
    };
  }

  if (totalBytes > maxBytes) {
    return {
      ok: false,
      totalBytes,
      message: t('errors.uploadOversizedTotal', {
        size: formatFileSize(totalBytes),
        limit: formatFileSize(maxBytes),
      }),
    };
  }

  return { ok: true, totalBytes };
}
