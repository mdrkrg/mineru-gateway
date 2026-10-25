import * as stylex from '@stylexjs/stylex';
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
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { forms } from '@/styles/forms.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { colors, radius, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/api-keys')({
  component: ApiKeysPage,
});

const styles = stylex.create({
  notSet: {
    color: colors.amber600,
  },
  code: {
    backgroundColor: colors.gray100,
    borderRadius: radius.px4,
    paddingInline: space.px8,
    paddingBlock: space.px4,
  },
  clear: {
    marginLeft: space.px12,
    color: colors.red600,
  },
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
    <div {...stylex.attrs(layout.stack24, layout.pageWidth896)}>
      <Show when={error()}>
        <p {...stylex.attrs(controls.alertError)}>{error()}</p>
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
      <section {...stylex.attrs(controls.card)}>
        <h2 {...stylex.attrs(typography.sectionTitle)}>{t('apiKeys.createTitle')}</h2>
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
        <h2 {...stylex.attrs(typography.sectionTitle)}>{t('apiKeys.listTitle')}</h2>
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
      <section {...stylex.attrs(controls.card)}>
        <h2
          {...stylex.attrs(
            layout.rowCenter8,
            typography.sectionTitleCompact,
          )}
        >
          <KeyRound class={stylex.attrs(icons.md).class} />
          {t('apiKeys.activeKeyTitle')}
        </h2>
        <p {...stylex.attrs(typography.bodyMuted, layout.mb16)}>
          {t('apiKeys.activeKeyDesc')}
        </p>
        <Show
          when={apiKeyStore.activeKey()}
          fallback={
            <p {...stylex.attrs(typography.body, layout.mb16, styles.notSet)}>
              {t('apiKeys.notSet')}
            </p>
          }
        >
          <p {...stylex.attrs(typography.body, layout.mb16)}>
            <code {...stylex.attrs(styles.code)}>
              {apiKeyStore.activeKey()!.slice(0, 12)}…
            </code>
            <button
              type="button"
              onClick={() => apiKeyStore.clearActiveKey()}
              {...stylex.attrs(actions.clear, styles.clear)}
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
          {...stylex.attrs(forms.rowTight)}
        >
          <label {...stylex.attrs(controls.field, layout.flex1)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('apiKeys.manualTitle')}</span>
            <input
              type="password"
              value={pastedKey()}
              onInput={(e) => setPastedKey(e.currentTarget.value)}
              placeholder={t('apiKeys.pastePlaceholder')}
              {...stylex.attrs(controls.input)}
            />
          </label>
          <button
            type="submit"
            {...stylex.attrs(controls.button, controls.buttonOutline, actions.weightNormal)}
          >
            {t('apiKeys.set')}
          </button>
        </form>
      </section>
    </div>
  );
}
