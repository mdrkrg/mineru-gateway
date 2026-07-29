import { Link, Outlet, createRootRoute } from '@tanstack/solid-router';
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools';
import type { AuthStore } from '../stores/auth';

export const Route = createRootRoute({
  beforeLoad: ({ context }) => {
    return (context as { auth: AuthStore }).auth.init();
  },
  component: RootComponent,
  pendingComponent: () => (
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
      <p class="text-gray-500">加载中…</p>
    </div>
  ),
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
  return (
    <>
      <Outlet />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  );
}
