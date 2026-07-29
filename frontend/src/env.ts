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
}

function readEnv(): AppEnv {
  return {
    apiPrefix: import.meta.env.VITE_API_PREFIX ?? '',
    dev: import.meta.env.DEV === true,
    prod: import.meta.env.PROD === true,
  };
}

export const env: AppEnv = readEnv();
