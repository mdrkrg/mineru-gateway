import { Outlet, createFileRoute } from '@tanstack/solid-router';
import AppShell from '../components/layout/AppShell';
import type { AuthStore } from '../stores/auth';
import { requireAuth } from '../stores/guard';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context }) => {
    requireAuth((context as { auth: AuthStore }).auth);
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
