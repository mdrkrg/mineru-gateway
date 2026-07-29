/**
 * Browser download helpers for blob responses.
 */

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
