import 'uno.css';
import { createEffect, createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import 'solid-devtools';
import { locale } from '@/i18n';
import { RouterProvider, createRouter } from '@tanstack/solid-router';
import { routeTree } from '@/routeTree.gen';
import { createAuthStore } from '@/stores/auth';
import { AuthProvider } from '@/stores/auth-context';
import { registerAuthHooks } from '@/core/http-client';
import { createApiKeyStore } from '@/stores/api-key';
import { ApiKeyProvider } from '@/stores/api-key-context';
import { createAdminTokenStore } from '@/stores/admin-token';
import { AdminTokenProvider } from '@/stores/admin-token-context';

const authStore = createAuthStore();
const apiKeyStore = createApiKeyStore();
const adminTokenStore = createAdminTokenStore();

registerAuthHooks(
  () => authStore.accessToken(),
  async () => {
    await authStore.refresh();
    return authStore.accessToken();
  },
  () => apiKeyStore.clearActiveKey(),
);

const router = createRouter({
  routeTree,
  context: { auth: authStore },
  defaultPreload: 'intent',
  defaultStaleTime: 5000,
  scrollRestoration: true,
});

// Keep <html lang> in sync with the active locale. Set it before the first
// render to avoid a flash of the wrong language, then track changes.
document.documentElement.lang = locale();
createRoot(() =>
  createEffect(() => {
    document.documentElement.lang = locale();
  }),
);

const rootElement = document.getElementById('root')!;

if (import.meta.env.DEV && !(rootElement instanceof HTMLElement)) {
  throw new Error(
    'Root element not found.',
  );
}

if (!rootElement.innerHTML) {
  render(
    () => (
      <AuthProvider store={authStore}>
        <ApiKeyProvider store={apiKeyStore}>
          <AdminTokenProvider store={adminTokenStore}>
            <RouterProvider router={router} />
          </AdminTokenProvider>
        </ApiKeyProvider>
      </AuthProvider>
    ),
    rootElement,
  );
}
