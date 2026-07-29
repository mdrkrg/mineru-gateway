import { Link, Outlet, createRootRoute } from '@tanstack/solid-router';
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools';

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
  return (
    <>
      <nav class="flex gap-4 p-4 border-b">
        <Link to="/" activeProps={{ class: 'font-bold' }} activeOptions={{ exact: true }}>
          Home
        </Link>
      </nav>
      <main class="p-4">
        <Outlet />
      </main>
      <TanStackRouterDevtools position="bottom-right" />
    </>
  );
}
