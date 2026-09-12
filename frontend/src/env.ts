/**
 * Typed access to `import.meta.env`.
 *
 * Centralizes all Vite environment variable reads so the rest of the app
 * never touches `import.meta.env` directly. Safe to import in non-Vite
 * contexts (tests) where `import.meta.env` may be undefined.
 */
interface AppEnv {
  /**
   * API base URL prefix for all gateway requests.
   * Defaults to `''` (same-origin; use a reverse proxy or Vite dev proxy).
   */
  readonly apiPrefix: string;
  /** True when running in Vite dev mode. */
  readonly dev: boolean;
  /** True for production builds. */
  readonly prod: boolean;
  /**
   * Max upload size per request, in bytes. Mirrors the gateway's
   * `GATEWAY_MAX_UPLOAD_SIZE` (default 500 MB). Overridable at build time via
   * `VITE_MAX_UPLOAD_SIZE`. Used for a client-side pre-check only — the
   * gateway remains the source of truth.
   */
  readonly maxUploadSizeBytes: number;
}

/** Gateway default for `GATEWAY_MAX_UPLOAD_SIZE` (500 MB). */
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;

function readEnv(): AppEnv {
  const rawMaxUpload = Number(import.meta.env.VITE_MAX_UPLOAD_SIZE);
  return {
    apiPrefix: import.meta.env.VITE_API_PREFIX ?? '',
    dev: import.meta.env.DEV === true,
    prod: import.meta.env.PROD === true,
    maxUploadSizeBytes:
      Number.isFinite(rawMaxUpload) && rawMaxUpload > 0
        ? rawMaxUpload
        : DEFAULT_MAX_UPLOAD_SIZE_BYTES,
  };
}

export const env: AppEnv = readEnv();
