import { Show, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { ShieldCheck } from 'lucide-solid';
import { t } from '@/i18n';
import { useAdminToken } from '@/stores/admin-token-context';

/**
 * Gates admin pages behind the gateway admin token (`X-Admin-Token`).
 * When no token is set, renders an input form; otherwise renders the
 * children plus a small "clear token" affordance.
 */
export default function AdminTokenGate(props: { children: JSX.Element }) {
  const store = useAdminToken();
  const [input, setInput] = createSignal('');

  return (
    <Show
      when={store.token()}
      fallback={
        <div class="bg-white rounded-lg shadow p-6 max-w-md">
          <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
            <ShieldCheck class="w-5 h-5" />
            {t('adminGate.title')}
          </h2>
          <p class="text-sm text-gray-500 mb-4">
            {t('adminGate.description')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = input().trim();
              if (t) {
                store.setToken(t);
                setInput('');
              }
            }}
            class="flex items-end gap-2"
          >
            <label class="flex flex-col gap-1 flex-1">
              <span class="text-sm font-medium text-gray-700">{t('adminGate.tokenLabel')}</span>
              <input
                type="password"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <button
              type="submit"
              class="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
            >
              {t('adminGate.submit')}
            </button>
          </form>
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        <p class="text-xs text-gray-400">
          {t('adminGate.setNotice')}
          <button
            type="button"
            onClick={() => store.clearToken()}
            class="ml-2 text-red-500 hover:underline"
          >
            {t('common.clear')}
          </button>
        </p>
        {props.children}
      </div>
    </Show>
  );
}
