import { redirect } from '@tanstack/solid-router';
import type { AuthStore } from './auth';

/**
 * Throws a redirect to `/login` if the user is not authenticated.
 *
 * Intended for use in route {@link beforeLoad} callbacks:
 *
 * ```ts
 * export const Route = createFileRoute('/dashboard')({
 *   beforeLoad: ({ context }) => {
 *     requireAuth(context.auth);
 *   },
 * });
 * ```
 *
 * @param auth - The auth store, typically accessed via router context.
 * @throws A {@link redirect} to `/login` when unauthenticated.
 */
export function requireAuth(auth: AuthStore) {
  if (!auth.isAuthenticated()) {
    throw redirect({ to: '/login' });
  }
}

/**
 * Like {@link requireAuth}, but additionally requires the current user to
 * be a superuser. Non-admin users are redirected to the dashboard.
 *
 * @param auth - The auth store, typically accessed via router context.
 * @throws A {@link redirect} to `/login` when unauthenticated, or to `/`
 *         when the user is not a superuser.
 */
export function requireSuperuser(auth: AuthStore) {
  requireAuth(auth);
  if (auth.user()?.isSuperuser !== true) {
    throw redirect({ to: '/' });
  }
}
