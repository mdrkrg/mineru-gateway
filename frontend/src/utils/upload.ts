import { t } from '@/i18n';
import { formatFileSize } from './format';

/** Result of a client-side upload-size pre-check. */
export type UploadSizeCheck =
  | { ok: true; totalBytes: number }
  | { ok: false; totalBytes: number; message: string };

export interface UploadLimits {
  maxTotalBytes: number;
  maxFileBytes: number;
  maxFiles: number;
}

/**
 * Pre-checks the selected files against the gateway's per-request upload
 * and MinerU's file-count and per-file limits so the user gets immediate
 * feedback instead of a 400/413 after a long upload. The gateway remains the
 * source of truth.
 *
 * @param files - Files selected for one submission.
 * @param limits - Client-side mirrors of the gateway/MinerU upload limits.
 */
export function validateUploadSize(
  files: readonly File[],
  limits: UploadLimits,
): UploadSizeCheck {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  if (files.length > limits.maxFiles) {
    return {
      ok: false,
      totalBytes,
      message: t('errors.uploadTooManyFiles', {
        count: files.length,
        limit: limits.maxFiles,
      }),
    };
  }

  const oversized = files.filter((file) => file.size > limits.maxFileBytes);
  if (oversized.length > 0) {
    const names = oversized.map((file) => file.name).join(t('common.listSeparator'));
    return {
      ok: false,
      totalBytes,
      message: t('errors.uploadOversizedFiles', {
        limit: formatFileSize(limits.maxFileBytes),
        names,
      }),
    };
  }

  if (totalBytes > limits.maxTotalBytes) {
    return {
      ok: false,
      totalBytes,
      message: t('errors.uploadOversizedTotal', {
        size: formatFileSize(totalBytes),
        limit: formatFileSize(limits.maxTotalBytes),
      }),
    };
  }

  return { ok: true, totalBytes };
}
