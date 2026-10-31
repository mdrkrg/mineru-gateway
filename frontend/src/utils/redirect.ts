import { ROUTES } from '@/utils/constants';

/**
 * Helpers for post-login redirects.
 *
 * The redirect target comes from the URL (`/login?redirect=...`), so it must
 * be treated as untrusted input. Only same-application absolute paths are
 * allowed; auth pages are rejected to prevent login loops.
 */

/** Maximum accepted redirect length; anything longer is not a real app path. */
const MAX_REDIRECT_LENGTH = 2048;

/** Parse base for normalizing the untrusted path; not the app's real origin. */
const PARSE_BASE = new URL('http://app.local');

const AUTH_PATHS = [ROUTES.login, ROUTES.register, ROUTES.oauthCallback];

const OAUTH_REDIRECT_STORAGE_KEY = 'gateway_oauth_redirect';

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Returns a safe application-relative path, or null when the value is not a
 * same-origin path or would redirect back to an auth page.
 *
 * Normalization via `URL` rejects absolute/protocol-relative URLs and dot
 * segments (`/tasks/../login`); control characters are rejected first because
 * `URL` silently strips them.
 */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return null;
  if (!value.startsWith('/')) return null;
  // Control characters can be used to smuggle a different URL through some
  // URL parsers; they never belong in an application path.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, PARSE_BASE);
  } catch {
    return null;
  }
  if (url.origin !== PARSE_BASE.origin) return null;
  // Dot segments can normalize an initially single-slash path to //host.
  if (url.pathname.startsWith('//')) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (isAuthPath(pathname)) return null;

  return url.pathname + url.search + url.hash;
}

function readOAuthRedirect(): string | null {
  try {
    return sessionStorage.getItem(OAUTH_REDIRECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeOAuthRedirect(value: string | null): void {
  try {
    if (value) sessionStorage.setItem(OAUTH_REDIRECT_STORAGE_KEY, value);
    else sessionStorage.removeItem(OAUTH_REDIRECT_STORAGE_KEY);
  } catch {
    // sessionStorage can be unavailable (privacy mode, blocked storage).
  }
}

/**
 * Remembers the post-login target across the OAuth provider round trip.
 *
 * The value is stored in sessionStorage because the provider redirect leaves
 * the SPA; it is scoped to the current tab and never leaves the browser.
 */
export function rememberOAuthRedirect(path: string): void {
  writeOAuthRedirect(safeRedirectPath(path));
}

/** Reads and clears the remembered OAuth target, re-validating it. */
export function takeOAuthRedirect(): string | null {
  const value = readOAuthRedirect();
  writeOAuthRedirect(null);
  return safeRedirectPath(value);
}

/** Drops a stale target when login completes outside the OAuth callback. */
export function clearOAuthRedirect(): void {
  writeOAuthRedirect(null);
}
