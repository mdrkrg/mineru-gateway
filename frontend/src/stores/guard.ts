import { redirect } from '@tanstack/solid-router';
import type { AuthStore } from '@/stores/auth';
import { safeRedirectPath } from '@/utils/redirect';

/**
 * Throws a redirect to `/login` if the user is not authenticated.
 *
 * Intended for use in route {@link beforeLoad} callbacks:
 *
 * ```ts
 * export const Route = createFileRoute('/dashboard')({
 *   beforeLoad: ({ context, location }) => {
 *     requireAuth(context.auth, location.href);
 *   },
 * });
 * ```
 *
 * @param auth - The auth store, typically accessed via router context.
 * @param currentHref - The current application-relative location. When set,
 *   the login page returns here after a successful sign-in.
 * @throws A {@link redirect} to `/login` when unauthenticated.
 */
export function requireAuth(auth: AuthStore, currentHref?: string) {
  if (!auth.isAuthenticated()) {
    const redirectTo = safeRedirectPath(currentHref);
    throw redirect({
      to: '/login',
      search: redirectTo ? { redirect: redirectTo } : undefined,
    });
  }
}

/**
 * Like {@link requireAuth}, but additionally requires the current user to
 * be a superuser. Non-admin users are redirected to the dashboard.
 *
 * @param auth - The auth store, typically accessed via router context.
 * @param currentHref - The current application-relative location, preserved
 *   when the user has to sign in first.
 * @throws A {@link redirect} to `/login` when unauthenticated, or to `/`
 *         when the user is not a superuser.
 */
export function requireSuperuser(auth: AuthStore, currentHref?: string) {
  requireAuth(auth, currentHref);
  if (auth.user()?.isSuperuser !== true) {
    throw redirect({ to: '/' });
  }
}
