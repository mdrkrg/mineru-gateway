import * as stylex from '@stylexjs/stylex';
import { Show, createSignal, onMount } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { t } from '@/i18n';
import { listTasks } from '@/api/functions/tasks';
import { useAuth } from '@/stores/auth-context';
import { useConfig } from '@/stores/config-context';
import { errorMessage } from '@/utils/api-error';
import { ROUTES } from '@/utils/constants';
import { safeRedirectPath } from '@/utils/redirect';
import { controls } from '@/styles/controls.stylex';
import { layout } from '@/styles/layout.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/key')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeRedirectPath(search.redirect) ?? undefined,
  }),
  component: KeyEntryPage,
});

function KeyEntryPage() {
  const auth = useAuth();
  const config = useConfig();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const destination = () => search().redirect ?? ROUTES.home;

  const [apiKey, setApiKeyInput] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [isSubmitting, setIsSubmitting] = createSignal(false);

  onMount(() => {
    // A pasted key or a live account already has what this page provides.
    // A stale JWT does not: auth.init() clears it, and redirecting here would
    // trap a key-only deployment on a dead session.
    if (auth.apiKey() !== null || auth.user() !== null) {
      navigate({ href: destination() });
    }
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const key = apiKey().trim();
    if (!key) return;

    setIsSubmitting(true);
    setError(null);
    // Prove the key works before storing it, so a typo fails here instead of
    // on every page behind the gate.
    const result = await listTasks({ apiKey: key, pageSize: 1 });
    setIsSubmitting(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }

    auth.setApiKey(key);
    navigate({ href: destination() });
  }

  return (
    <div {...stylex.attrs(layout.centeredPage)}>
      <div {...stylex.attrs(layout.panel)}>
        <h1 {...stylex.attrs(typography.heroTitle)}>{t('keyEntry.title')}</h1>
        <p {...stylex.attrs(typography.bodyMuted, layout.mb24)}>
          {t('keyEntry.description')}
        </p>

        <Show when={error()}>
          <p {...stylex.attrs(controls.errorText, layout.mb16)}>{error()}</p>
        </Show>

        <form onSubmit={handleSubmit} {...stylex.attrs(layout.stack16)}>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('keyEntry.label')}</span>
            <input
              type="text"
              required
              autocomplete="off"
              spellcheck={false}
              value={apiKey()}
              placeholder={t('keyEntry.placeholder')}
              onInput={(e) => setApiKeyInput(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting() || apiKey().trim().length === 0}
            {...stylex.attrs(
              controls.button,
              controls.buttonPrimary,
              controls.buttonLarge,
            )}
          >
            {isSubmitting() ? t('keyEntry.submitting') : t('keyEntry.submit')}
          </button>
        </form>

        <p {...stylex.attrs(typography.metaMuted, layout.mt16)}>
          {t('keyEntry.memoryOnly')}
        </p>

        <Show when={config.userAuthEnabled()}>
          <p
            {...stylex.attrs(
              typography.bodyMuted,
              layout.textCenter,
              layout.mt16,
            )}
          >
            <Link to={ROUTES.login} class={stylex.attrs(controls.link).class}>
              {t('keyEntry.loginInstead')}
            </Link>
          </p>
        </Show>
      </div>
    </div>
  );
}
