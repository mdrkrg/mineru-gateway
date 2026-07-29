import { redirect } from '@tanstack/solid-router';
import type { AuthStore } from './auth';

export function requireAuth(auth: AuthStore) {
  if (!auth.isAuthenticated()) {
    throw redirect({ to: '/login' });
  }
}
