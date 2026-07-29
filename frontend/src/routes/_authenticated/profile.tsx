import { Show, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { updateCurrentUser } from '@/api/functions/auth';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';
import { formatDateTime } from '@/utils/format';

export const Route = createFileRoute('/_authenticated/profile')({
  component: ProfilePage,
});

const inputCls =
  'border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

function ProfilePage() {
  const auth = useAuth();

  const [displayName, setDisplayName] = createSignal(auth.user()?.displayName ?? '');
  const [password, setPassword] = createSignal('');
  const [confirm, setConfirm] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);

  async function handleSave(e: SubmitEvent) {
    e.preventDefault();

    setError(null);
    setSaved(false);

    if (password() && password() !== confirm()) {
      setError('两次输入的密码不一致');
      return;
    }

    const name = displayName().trim();
    const currentName = auth.user()?.displayName ?? '';
    if (!password() && name === currentName) {
      setError('没有需要保存的修改');
      return;
    }

    setIsSaving(true);
    const result = await updateCurrentUser(
      {
        password: password() || null,
        displayName: name !== currentName ? name || null : null,
      },
    );
    setIsSaving(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }

    setPassword('');
    setConfirm('');
    setSaved(true);
    await auth.init();
  }

  return (
    <div class="max-w-2xl flex flex-col gap-4">
      <section class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">账号信息</h2>
        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">邮箱</dt>
            <dd>{auth.user()?.email}</dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">角色</dt>
            <dd>{auth.user()?.isSuperuser ? '管理员' : '普通用户'}</dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">邮箱验证</dt>
            <dd>{auth.user()?.isVerified ? '已验证' : '未验证'}</dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">注册时间</dt>
            <dd>{formatDateTime(auth.user()?.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">修改资料</h2>

        <Show when={error()}>
          <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
            {error()}
          </p>
        </Show>
        <Show when={saved()}>
          <p class="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2 mb-4">
            已保存
          </p>
        </Show>

        <form onSubmit={handleSave} class="flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">显示名称</span>
            <input
              type="text"
              value={displayName()}
              onInput={(e) => setDisplayName(e.currentTarget.value)}
              class={inputCls}
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">新密码(留空则不修改)</span>
            <input
              type="password"
              autocomplete="new-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              class={inputCls}
            />
          </label>
          <Show when={password()}>
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium text-gray-700">确认新密码</span>
              <input
                type="password"
                autocomplete="new-password"
                value={confirm()}
                onInput={(e) => setConfirm(e.currentTarget.value)}
                class={inputCls}
              />
            </label>
          </Show>
          <button
            type="submit"
            disabled={isSaving()}
            class="self-start bg-blue-600 text-white rounded px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving() ? '保存中…' : '保存'}
          </button>
        </form>
      </section>
    </div>
  );
}
