import { Show, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { adminCreateUser } from '@/api/functions/auth';
import type { UserRead } from '@/api/schemas/auth';
import AdminTokenGate from '@/components/AdminTokenGate';
import type { AuthStore } from '@/stores/auth';
import { useAdminToken } from '@/stores/admin-token-context';
import { requireSuperuser } from '@/stores/guard';
import { errorMessage } from '@/utils/api-error';

export const Route = createFileRoute('/_authenticated/admin/users')({
  beforeLoad: ({ context }) => {
    requireSuperuser((context as { auth: AuthStore }).auth);
  },
  component: AdminUsersPage,
});

const inputCls =
  'border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

function AdminUsersPage() {
  return (
    <AdminTokenGate>
      <AdminUsersContent />
    </AdminTokenGate>
  );
}

function AdminUsersContent() {
  const adminToken = useAdminToken();

  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [isSuperuser, setIsSuperuser] = createSignal(false);
  const [isVerified, setIsVerified] = createSignal(true);
  const [isCreating, setIsCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [created, setCreated] = createSignal<UserRead | null>(null);

  async function handleCreate(e: SubmitEvent) {
    e.preventDefault();
    const token = adminToken.token();
    if (!token) return;

    setIsCreating(true);
    setError(null);
    setCreated(null);

    const result = await adminCreateUser(
      {
        email: email(),
        password: password(),
        displayName: displayName().trim() || null,
        isActive: null,
        isSuperuser: isSuperuser(),
        isVerified: isVerified(),
      },
      token,
    );
    setIsCreating(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }

    setCreated(result.value);
    setEmail('');
    setPassword('');
    setDisplayName('');
    setIsSuperuser(false);
  }

  return (
    <div class="max-w-xl flex flex-col gap-4">
      <Show when={error()}>
        <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error()}
        </p>
      </Show>

      <Show when={created()}>
        {(u) => (
          <div class="bg-green-50 border border-green-300 rounded-lg p-4">
            <h3 class="font-semibold text-green-800 mb-1">用户创建成功</h3>
            <p class="text-sm text-green-700">
              {u().email}
              {u().displayName ? `(${u().displayName})` : ''}
              {u().isSuperuser ? ' · 管理员' : ''}
            </p>
          </div>
        )}
      </Show>

      <section class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">创建用户</h2>
        <form onSubmit={handleCreate} class="flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">邮箱</span>
            <input
              type="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              class={inputCls}
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">初始密码</span>
            <input
              type="password"
              required
              autocomplete="new-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              class={inputCls}
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">显示名称(可选)</span>
            <input
              type="text"
              value={displayName()}
              onInput={(e) => setDisplayName(e.currentTarget.value)}
              class={inputCls}
            />
          </label>
          <div class="flex gap-6">
            <label class="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={isVerified()}
                onChange={(e) => setIsVerified(e.currentTarget.checked)}
              />
              标记为已验证
            </label>
            <label class="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={isSuperuser()}
                onChange={(e) => setIsSuperuser(e.currentTarget.checked)}
              />
              管理员
            </label>
          </div>
          <button
            type="submit"
            disabled={isCreating()}
            class="self-start bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreating() ? '创建中…' : '创建用户'}
          </button>
        </form>
      </section>
    </div>
  );
}
