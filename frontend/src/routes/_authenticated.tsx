import { Outlet, createFileRoute } from '@tanstack/solid-router';
import EmailVerificationDialog from '@/components/EmailVerificationDialog';
import AppShell from '@/components/layout/AppShell';
import { requireAuth } from '@/stores/guard';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    requireAuth(context.auth, context.config, location.href);
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <AppShell>
      <EmailVerificationDialog />
      <Outlet />
    </AppShell>
  );
}
