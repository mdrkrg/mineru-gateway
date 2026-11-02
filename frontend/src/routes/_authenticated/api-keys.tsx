import * as stylex from '@stylexjs/stylex';
import { Show, createSignal, onMount } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { requireUser } from '@/stores/guard';
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
import { useConfirm } from '@/stores/confirm-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';
import { controls } from '@/styles/controls.stylex';
import { forms } from '@/styles/forms.stylex';
import { layout } from '@/styles/layout.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/api-keys')({
  beforeLoad: ({ context, location }) => {
    requireUser(context.auth, context.config, location.href);
  },
  component: ApiKeysPage,
});

function ApiKeysPage() {
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
    <div {...stylex.attrs(layout.stack24, layout.pageWidth896)}>
      <p {...stylex.attrs(typography.bodyMuted)}>{t('apiKeys.description')}</p>

      <Show when={error()}>
        <p {...stylex.attrs(controls.alert, controls.alertError)}>{error()}</p>
      </Show>

      {/* Newly created key — shown once */}
      <Show when={created()}>
        {(c) => (
          <ApiKeyReveal created={c()} />
        )}
      </Show>

      {/* Create form */}
      <section {...stylex.attrs(controls.card)}>
        <h2 {...stylex.attrs(typography.sectionHeading, layout.mb16)}>{t('apiKeys.createTitle')}</h2>
        <form onSubmit={handleCreate} {...stylex.attrs(forms.row)}>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('apiKeys.label')}</span>
            <input
              type="text"
              value={label()}
              onInput={(e) => setLabel(e.currentTarget.value)}
              placeholder={t('apiKeys.labelPlaceholder')}
              {...stylex.attrs(controls.input, forms.inputMedium)}
            />
          </label>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('apiKeys.expiresAt')}</span>
            <input
              type="date"
              value={expiresAt()}
              onInput={(e) => setExpiresAt(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            />
          </label>
          <button
            type="submit"
            disabled={isCreating()}
            {...stylex.attrs(controls.button, controls.buttonPrimary, controls.buttonLarge)}
          >
            {isCreating() ? t('apiKeys.creating') : t('apiKeys.create')}
          </button>
        </form>
      </section>

      {/* Key list */}
      <section {...stylex.attrs(controls.card)}>
        <h2 {...stylex.attrs(typography.sectionHeading, layout.mb16)}>{t('apiKeys.listTitle')}</h2>
        <ApiKeyTable
          keys={keys()}
          isLoading={isLoading()}
          emptyText={t('apiKeys.empty')}
          revokingId={revokingId()}
          onRevoke={handleRevoke}
        />
      </section>
    </div>
  );
}
