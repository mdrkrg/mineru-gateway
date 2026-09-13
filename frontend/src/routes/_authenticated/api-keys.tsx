import { Show, createSignal, onMount } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { KeyRound } from 'lucide-solid';
import {
  createMyApiKey,
  listMyApiKeys,
  revokeMyApiKey,
} from '@/api/functions/auth';
import type { ApiKeyCreatedResponse, ApiKeyInfo } from '@/api/schemas/auth';
import ApiKeyReveal from '@/components/ApiKeyReveal';
import ApiKeyTable from '@/components/ApiKeyTable';
import { t } from '@/i18n';
import { isHttpError } from '@/core/error-model';
import { useApiKey } from '@/stores/api-key-context';
import { useConfirm } from '@/stores/confirm-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';

export const Route = createFileRoute('/_authenticated/api-keys')({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const apiKeyStore = useApiKey();
  const toast = useToast();
  const confirm = useConfirm();

  const [keys, setKeys] = createSignal<ApiKeyInfo[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [revokingId, setRevokingId] = createSignal<string | null>(null);

  // Create form state
  const [label, setLabel] = createSignal('');
  const [expiresAt, setExpiresAt] = createSignal('');
  const [isCreating, setIsCreating] = createSignal(false);
  const [created, setCreated] = createSignal<ApiKeyCreatedResponse | null>(null);

  // Manual active-key paste
  const [pastedKey, setPastedKey] = createSignal('');

  // `silent` keeps the current table mounted while reconciling with the
  // server, so post-action refreshes do not flash a loading state.
  async function loadKeys(opts: { silent?: boolean } = {}) {
    if (!opts.silent) {
      setIsLoading(true);
      setError(null);
    }
    const result = await listMyApiKeys();
    if (result.isErr()) {
      setError(errorMessage(result.error));
    } else {
      setKeys(result.value.keys);
    }
    if (!opts.silent) setIsLoading(false);
  }

  onMount(loadKeys);

  async function handleCreate(e: SubmitEvent) {
    e.preventDefault();

    setIsCreating(true);
    setError(null);
    setCreated(null);

    const result = await createMyApiKey(
      {
        label: label().trim() || null,
        expiresAt: expiresAt() ? new Date(expiresAt()).toISOString() : null,
      },
    );
    setIsCreating(false);

    if (result.isErr()) {
      const err = result.error;
      if (isHttpError(err) && err.status === 403) {
        setError(t('apiKeys.errUnverified'));
      } else {
        setError(errorMessage(err));
      }
      return;
    }

    setCreated(result.value);
    setLabel('');
    setExpiresAt('');
    toast.show(t('apiKeys.createdToast'), 'success');
    await loadKeys({ silent: true });
  }

  async function handleRevoke(key: ApiKeyInfo) {
    const confirmed = await confirm.ask({
      title: t('keyTable.revokeTitle'),
      description: t('keyTable.confirmRevoke', { name: key.label || key.apiKeyPrefix }),
      confirmText: t('keyTable.revoke'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setError(null);
    setRevokingId(key.id);
    const result = await revokeMyApiKey(key.id);
    if (result.isErr()) {
      setRevokingId(null);
      setError(errorMessage(result.error));
      return;
    }

    // Flip the row in place first, then reconcile silently, so the table
    // never unmounts and the revoked key stays visible with its new status.
    setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, isActive: false } : k)));
    setRevokingId(null);
    toast.show(t('keyTable.revokedToast'), 'success');
    await loadKeys({ silent: true });
  }

  return (
    <div class="max-w-4xl flex flex-col gap-6">
      <Show when={error()}>
        <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error()}
        </p>
      </Show>

      {/* Newly created key — shown once */}
      <Show when={created()}>
        {(c) => (
          <ApiKeyReveal
            created={c()}
            onUseKey={(key) => apiKeyStore.setActiveKey(key)}
          />
        )}
      </Show>

      {/* Create form */}
      <section class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">{t('apiKeys.createTitle')}</h2>
        <form onSubmit={handleCreate} class="flex flex-wrap items-end gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">{t('apiKeys.label')}</span>
            <input
              type="text"
              value={label()}
              onInput={(e) => setLabel(e.currentTarget.value)}
              placeholder={t('apiKeys.labelPlaceholder')}
              class="border border-gray-300 rounded px-3 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium text-gray-700">{t('apiKeys.expiresAt')}</span>
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
            {isCreating() ? t('apiKeys.creating') : t('apiKeys.create')}
          </button>
        </form>
      </section>

      {/* Key list */}
      <section class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">{t('apiKeys.listTitle')}</h2>
        <ApiKeyTable
          keys={keys()}
          isLoading={isLoading()}
          emptyText={t('apiKeys.empty')}
          activePrefix={apiKeyStore.activeKey()}
          revokingId={revokingId()}
          onRevoke={handleRevoke}
        />
      </section>

      {/* Active key for task endpoints */}
      <section class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
          <KeyRound class="w-5 h-5" />
          {t('apiKeys.activeKeyTitle')}
        </h2>
        <p class="text-sm text-gray-500 mb-4">
          {t('apiKeys.activeKeyDesc')}
        </p>
        <Show
          when={apiKeyStore.activeKey()}
          fallback={<p class="text-sm text-amber-600 mb-4">{t('apiKeys.notSet')}</p>}
        >
          <p class="text-sm mb-4">
            <code class="bg-gray-100 rounded px-2 py-1">
              {apiKeyStore.activeKey()!.slice(0, 12)}…
            </code>
            <button
              type="button"
              onClick={() => apiKeyStore.clearActiveKey()}
              class="ml-3 text-red-600 hover:underline"
            >
              {t('common.clear')}
            </button>
          </p>
        </Show>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const k = pastedKey().trim();
            if (k) {
              apiKeyStore.setActiveKey(k);
              setPastedKey('');
            }
          }}
          class="flex items-end gap-2"
        >
          <label class="flex flex-col gap-1 flex-1">
            <span class="text-sm font-medium text-gray-700">{t('apiKeys.manualTitle')}</span>
            <input
              type="password"
              value={pastedKey()}
              onInput={(e) => setPastedKey(e.currentTarget.value)}
              placeholder={t('apiKeys.pastePlaceholder')}
              class="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button
            type="submit"
            class="border border-gray-300 rounded px-4 py-2 text-sm hover:bg-gray-50"
          >
            {t('apiKeys.set')}
          </button>
        </form>
      </section>
    </div>
  );
}
