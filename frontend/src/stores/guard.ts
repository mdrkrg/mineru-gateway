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
