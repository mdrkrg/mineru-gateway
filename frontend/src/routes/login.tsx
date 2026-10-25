import * as stylex from '@stylexjs/stylex';
import { Show, createSignal, onMount, For } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { t } from '@/i18n';
import { useAuth } from '@/stores/auth-context';
import { getOAuthProviders } from '@/api/functions/auth';
import { ROUTES } from '@/utils/constants';
import { env } from '@/env';
import { auth as authStyles } from '@/styles/auth.stylex';
import { controls } from '@/styles/controls.stylex';
import { layout } from '@/styles/layout.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function buildOAuthRedirectUrl(provider: string): string {
  const path = `/auth/oauth/${provider}/authorize`;
  const base = env.apiPrefix.replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [providers, setProviders] = createSignal<{ name: string }[]>([]);

  onMount(async () => {
    if (auth.isAuthenticated()) {
      navigate({ to: ROUTES.home });
    }
    const result = await getOAuthProviders();
    if (result.isOk()) {
      setProviders(result.value.providers);
    }
  });

  function handleOAuthLogin(provider: string) {
    window.location.assign(buildOAuthRedirectUrl(provider));
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    await auth.login(email(), password());
    if (auth.isAuthenticated()) {
      navigate({ to: ROUTES.home });
    }
  }

  return (
    <div {...stylex.attrs(layout.centeredPage)}>
      <div {...stylex.attrs(layout.panel)}>
        <h1 {...stylex.attrs(typography.heroTitle)}>{t('login.title')}</h1>
        <p {...stylex.attrs(typography.bodyMuted, layout.textCenter, layout.mb24)}>
          MinerU Gateway
        </p>

        <form onSubmit={handleSubmit} {...stylex.attrs(layout.stack16)}>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('login.email')}</span>
            <input
              type="email"
              required
              autocomplete="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            />
          </label>

          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('login.password')}</span>
            <input
              type="password"
              required
              autocomplete="current-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            />
          </label>

          <Show when={auth.error()}>
            <p {...stylex.attrs(controls.errorText)}>{auth.error()}</p>
          </Show>

          <button
            type="submit"
            disabled={auth.isLoading()}
            {...stylex.attrs(controls.button, controls.buttonPrimary, controls.buttonLarge)}
          >
            {auth.isLoading() ? t('login.submitting') : t('login.submit')}
          </button>
        </form>

        <Show when={providers().length > 0}>
          <div {...stylex.attrs(layout.mt16)}>
            <div {...stylex.attrs(layout.rowCenter8, layout.mb12)}>
              <div {...stylex.attrs(authStyles.dividerLine)} />
              <span {...stylex.attrs(typography.metaFaint)}>{t('login.oauthDivider')}</span>
              <div {...stylex.attrs(authStyles.dividerLine)} />
            </div>
            <div {...stylex.attrs(layout.stack8)}>
              <For each={providers()}>
                {(p) => (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin(p.name)}
                    {...stylex.attrs(
                      controls.button,
                      controls.buttonOutline,
                      layout.fullWidth,
                    )}
                  >
                    {t('login.oauthButton', { provider: p.name })}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <p {...stylex.attrs(typography.bodyMuted, layout.textCenter, layout.mt16)}>
          {t('login.noAccount')}{' '}
          <Link to={ROUTES.register} class={stylex.attrs(controls.link).class}>
            {t('login.toRegister')}
          </Link>
        </p>
      </div>
    </div>
  );
}
