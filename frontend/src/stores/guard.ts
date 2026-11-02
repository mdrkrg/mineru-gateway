import { redirect } from '@tanstack/solid-router';
import type { AuthStore } from '@/stores/auth';
import type { ConfigStore } from '@/stores/config';
import { safeRedirectPath } from '@/utils/redirect';

/**
 * Throws a redirect when the caller has no credential.
 *
 * A credential is either a JWT session or an API key pasted into the panel.
 * Key-only deployments have no login route, so they are sent to `/key`
 * instead of `/login`.
 *
 * @param auth - The auth store, accessed via router context.
 * @param config - The gateway config store, accessed via router context.
 * @param currentHref - The current application-relative location, preserved
 *   so the login/key screen can return here afterwards.
 * @throws A {@link redirect} to `/login` or `/key`.
 */
export function requireAuth(
  auth: AuthStore,
  config: ConfigStore,
  currentHref?: string,
) {
  if (auth.hasCredential()) return;

  const redirectTo = safeRedirectPath(currentHref);
  const target = config.userAuthEnabled() ? '/login' : '/key';
  throw redirect({
    to: target,
    search: redirectTo ? { redirect: redirectTo } : undefined,
  });
}

/**
 * Like {@link requireAuth}, but additionally requires the current user to
 * be a superuser. API-key sessions have no user, so they are sent home.
 *
 * @throws A {@link redirect} to `/login`/`/key` when unauthenticated, or to
 *         `/` when the caller is not a superuser.
 */
export function requireSuperuser(
  auth: AuthStore,
  config: ConfigStore,
  currentHref?: string,
) {
  requireAuth(auth, config, currentHref);
  // Key-only deployments have no users; the admin token gate is the authority
  // there, and it is stricter than a superuser check.
  if (!config.userAuthEnabled()) return;
  if (auth.user()?.isSuperuser !== true) {
    throw redirect({ to: '/' });
  }
}

/**
 * Like {@link requireAuth}, but requires a JWT user. Self-service keys and the
 * profile page belong to the login stack; a pasted API key is sent home
 * instead of failing every request on those pages.
 */
export function requireUser(
  auth: AuthStore,
  config: ConfigStore,
  currentHref?: string,
) {
  requireAuth(auth, config, currentHref);
  if (auth.user() === null) {
    throw redirect({ to: '/' });
  }
}
