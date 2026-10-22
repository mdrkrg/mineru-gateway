import * as stylex from '@stylexjs/stylex';
import { Show, createSignal, onMount } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '@/api/functions/auth';
import type { ApiKeyCreatedResponse, ApiKeyInfo } from '@/api/schemas/auth';
import AdminTokenGate from '@/components/AdminTokenGate';
import ApiKeyReveal from '@/components/ApiKeyReveal';
import ApiKeyTable from '@/components/ApiKeyTable';
import { t } from '@/i18n';
import type { AuthStore } from '@/stores/auth';
import { useAdminToken } from '@/stores/admin-token-context';
import { useConfirm } from '@/stores/confirm-context';
import { useToast } from '@/stores/toast-context';
import { requireSuperuser } from '@/stores/guard';
import { errorMessage } from '@/utils/api-error';
import { controls } from '@/styles/controls.stylex';
import { forms } from '@/styles/forms.stylex';
import { layout } from '@/styles/layout.stylex';
import { maxWidth } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/admin/keys')({
  beforeLoad: ({ context }) => {
    requireSuperuser((context as { auth: AuthStore }).auth);
  },
  component: AdminKeysPage,
});

const styles = stylex.create({
  root: {
    maxWidth: maxWidth.px896,
  },
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
  const toast = useToast();
  const confirm = useConfirm();

  const [keys, setKeys] = createSignal<ApiKeyInfo[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [revokingId, setRevokingId] = createSignal<string | null>(null);

  const [label, setLabel] = createSignal('');
  const [expiresAt, setExpiresAt] = createSignal('');
  const [isCreating, setIsCreating] = createSignal(false);
  const [created, setCreated] = createSignal<ApiKeyCreatedResponse | null>(null);

  // `silent` keeps the current table mounted while reconciling with the
  // server, so post-action refreshes do not flash a loading state.
  async function loadKeys(opts: { silent?: boolean } = {}) {
    const token = adminToken.token();
    if (!token) return;
    if (!opts.silent) {
      setIsLoading(true);
      setError(null);
    }
    const result = await listApiKeys(token);
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
    toast.show(t('adminKeys.issuedToast'), 'success');
    await loadKeys({ silent: true });
  }

  async function handleRevoke(key: ApiKeyInfo) {
    const token = adminToken.token();
    if (!token) return;
    const confirmed = await confirm.ask({
      title: t('keyTable.revokeTitle'),
      description: t('keyTable.confirmRevoke', { name: key.label || key.apiKeyPrefix }),
      confirmText: t('keyTable.revoke'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setError(null);
    setRevokingId(key.id);
    const result = await revokeApiKey(key.id, token);
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
    <div {...stylex.attrs(layout.stack24, styles.root)}>
      <Show when={error()}>
        <p {...stylex.attrs(controls.alertError)}>{error()}</p>
      </Show>

      <Show when={created()}>
        {(c) => <ApiKeyReveal created={c()} />}
      </Show>

      <section {...stylex.attrs(controls.card)}>
        <h2 {...stylex.attrs(typography.sectionTitle)}>{t('adminKeys.issueTitle')}</h2>
        <form onSubmit={handleCreate} {...stylex.attrs(forms.row)}>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('adminKeys.label')}</span>
            <input
              type="text"
              value={label()}
              onInput={(e) => setLabel(e.currentTarget.value)}
              {...stylex.attrs(controls.input, forms.inputMedium)}
            />
          </label>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('adminKeys.expiresAt')}</span>
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
            {isCreating() ? t('adminKeys.issuing') : t('adminKeys.issue')}
          </button>
        </form>
      </section>

      <section {...stylex.attrs(controls.card)}>
        <h2 {...stylex.attrs(typography.sectionTitle)}>{t('adminKeys.listTitle')}</h2>
        <ApiKeyTable
          keys={keys()}
          isLoading={isLoading()}
          emptyText={t('adminKeys.empty')}
          revokingId={revokingId()}
          onRevoke={handleRevoke}
        />
      </section>
    </div>
  );
}
