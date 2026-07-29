import { onMount } from 'solid-js';
import { Link, Outlet, createRootRoute } from '@tanstack/solid-router';
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools';
import type { AuthStore } from '../stores/auth';

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => {
    return (
      <div class="p-8 text-center">
        <h1 class="text-2xl font-bold mb-4">404 - Page Not Found</h1>
        <Link to="/" class="text-blue-600 hover:underline">Go Home</Link>
      </div>
    );
  },
});

function RootComponent() {
  const ctx = Route.useRouteContext();
  const auth = ctx().auth as AuthStore;

  onMount(() => {
    auth.init();
  });

  return (
    <>
      <Outlet />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  );
}
