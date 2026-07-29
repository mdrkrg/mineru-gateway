import { Show, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { ShieldCheck } from 'lucide-solid';
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
            需要管理令牌
          </h2>
          <p class="text-sm text-gray-500 mb-4">
            管理接口使用网关管理令牌(GATEWAY_ADMIN_TOKEN)鉴权,仅保存在当前标签页中。
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
              <span class="text-sm font-medium text-gray-700">管理令牌</span>
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
              确定
            </button>
          </form>
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        <p class="text-xs text-gray-400">
          管理令牌已设置(仅当前标签页)
          <button
            type="button"
            onClick={() => store.clearToken()}
            class="ml-2 text-red-500 hover:underline"
          >
            清除
          </button>
        </p>
        {props.children}
      </div>
    </Show>
  );
}
