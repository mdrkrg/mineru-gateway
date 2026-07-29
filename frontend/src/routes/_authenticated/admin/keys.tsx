import { For, Show, createSignal, onMount } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { Trash2 } from 'lucide-solid';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '@/api/functions/auth';
import type { ApiKeyCreatedResponse, ApiKeyInfo } from '@/api/schemas/auth';
import AdminTokenGate from '@/components/AdminTokenGate';
import ApiKeyReveal from '@/components/ApiKeyReveal';
import type { AuthStore } from '@/stores/auth';
import { useAdminToken } from '@/stores/admin-token-context';
import { requireSuperuser } from '@/stores/guard';
import { errorMessage } from '@/utils/api-error';
import { formatDateTime } from '@/utils/format';

export const Route = createFileRoute('/_authenticated/admin/keys')({
  beforeLoad: ({ context }) => {
    requireSuperuser((context as { auth: AuthStore }).auth);
  },
  component: AdminKeysPage,
});

function AdminKeysPage() {
  return (
    <AdminTokenGate>
      <AdminKeysContent />
    </AdminTokenGate>
  );
}

function AdminKeysContent() {
  const adminToken = useAdminToken();

  const [keys, setKeys] = createSignal<ApiKeyInfo[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const [label, setLabel] = createSignal('');
  const [expiresAt, setExpiresAt] = createSignal('');
  const [isCreating, setIsCreating] = createSignal(false);
  const [created, setCreated] = createSignal<ApiKeyCreatedResponse | null>(null);

  async function loadKeys() {
    const token = adminToken.token();
    if (!token) return;
    setIsLoading(true);
    setError(null);
    const result = await listApiKeys(token);
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      setKeys(result.value.keys);
    }
    setIsLoading(false);
  }

  onMount(loadKeys);

  async function handleCreate(e: SubmitEvent) {
    e.preventDefault();
    const token = adminToken.token();
    if (!token) return;

    setIsCreating(true);
    setError(null);
    setCreated(null);

    const result = await createApiKey(
      {
        label: label().trim() || null,
        expiresAt: expiresAt() ? new Date(expiresAt()).toISOString() : null,
      },
      token,
    );
    setIsCreating(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }

    setCreated(result.value);
    setLabel('');
    setExpiresAt('');
    await loadKeys();
  }

  async function handleRevoke(key: ApiKeyInfo) {
    const token = adminToken.token();
    if (!token) return;
    if (!window.confirm(`确定吊销 Key「${key.label || key.apiKeyPrefix}」吗?此操作不可撤销。`)) {
      return;
    }

    setError(null);
    const result = await revokeApiKey(key.id, token);
    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }
    await loadKeys();
  }

  return (
    <div class="max-w-4xl flex flex-col gap-6">
      <Show when={error()}>
        <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error()}
        </p>
      </Show>

      <Show when={created()}>
        {(c) => <ApiKeyReveal created={c()} />}
      </Show>

      <section class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">签发新 Key</h2>
        <form onSubmit={handleCreate} class="flex flex-wrap items-end gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">备注(可选)</span>
            <input
              type="text"
              value={label()}
              onInput={(e) => setLabel(e.currentTarget.value)}
              class="border border-gray-300 rounded px-3 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">过期时间(可选)</span>
            <input
              type="date"
              value={expiresAt()}
              onInput={(e) => setExpiresAt(e.currentTarget.value)}
              class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button
            type="submit"
            disabled={isCreating()}
            class="bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreating() ? '签发中…' : '签发'}
          </button>
        </form>
      </section>

      <section class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">全部 Keys</h2>
        <Show when={!isLoading()} fallback={<p class="text-gray-500">加载中…</p>}>
          <Show
            when={keys().length > 0}
            fallback={<p class="text-gray-500">还没有任何 API Key。</p>}
          >
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-gray-500 border-b">
                  <th class="py-2 pr-4 font-medium">前缀</th>
                  <th class="py-2 pr-4 font-medium">备注</th>
                  <th class="py-2 pr-4 font-medium">创建时间</th>
                  <th class="py-2 pr-4 font-medium">最近使用</th>
                  <th class="py-2 pr-4 font-medium">过期时间</th>
                  <th class="py-2 pr-4 font-medium">状态</th>
                  <th class="py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <For each={keys()}>
                  {(key) => (
                    <tr class="border-b last:border-0">
                      <td class="py-2 pr-4">
                        <code class="text-xs">{key.apiKeyPrefix}…</code>
                      </td>
                      <td class="py-2 pr-4">{key.label || '—'}</td>
                      <td class="py-2 pr-4">{formatDateTime(key.createdAt)}</td>
                      <td class="py-2 pr-4">{formatDateTime(key.lastUsedAt)}</td>
                      <td class="py-2 pr-4">{formatDateTime(key.expiresAt)}</td>
                      <td class="py-2 pr-4">
                        <span
                          class={
                            key.isActive
                              ? 'text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5'
                              : 'text-xs bg-gray-100 text-gray-500 rounded px-1.5 py-0.5'
                          }
                        >
                          {key.isActive ? '有效' : '已吊销'}
                        </span>
                      </td>
                      <td class="py-2">
                        <Show when={key.isActive}>
                          <button
                            type="button"
                            onClick={() => handleRevoke(key)}
                            class="flex items-center gap-1 text-red-600 hover:underline text-sm"
                          >
                            <Trash2 class="w-3.5 h-3.5" />
                            吊销
                          </button>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>
      </section>
    </div>
  );
}
