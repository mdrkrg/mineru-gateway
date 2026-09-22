import * as stylex from '@stylexjs/stylex';
import { Show, createSignal, onMount, For } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { t } from '@/i18n';
import { useAuth } from '@/stores/auth-context';
import { getOAuthProviders } from '@/api/functions/auth';
import { ROUTES } from '@/utils/constants';
import { env } from '@/env';
import { controls } from '@/styles/controls.stylex';
import { layout } from '@/styles/layout.stylex';
import {
  colors,
  fontSize,
  lineHeight,
  space,
} from '@/styles/tokens.stylex';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function buildOAuthRedirectUrl(provider: string): string {
  const path = `/auth/oauth/${provider}/authorize`;
  const base = env.apiPrefix.replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

const styles = stylex.create({
  title: {
    fontSize: fontSize.px24,
    lineHeight: lineHeight.px32,
    fontWeight: 700,
    textAlign: 'center',
    marginBottom: space.px8,
  },
  subtitle: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
    textAlign: 'center',
    marginBottom: space.px24,
  },
  oauthSection: {
    marginTop: space.px16,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px8,
    marginBottom: space.px12,
  },
  dividerLine: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.gray200,
  },
  dividerText: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    color: colors.gray400,
  },
  oauthButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px8,
  },
  oauthButton: {
    width: '100%',
  },
  footer: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
    textAlign: 'center',
    marginTop: space.px16,
  },
});

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
        <h1 {...stylex.attrs(styles.title)}>{t('login.title')}</h1>
        <p {...stylex.attrs(styles.subtitle)}>MinerU Gateway</p>

        <form onSubmit={handleSubmit} {...stylex.attrs(controls.form)}>
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
          <div {...stylex.attrs(styles.oauthSection)}>
            <div {...stylex.attrs(styles.divider)}>
              <div {...stylex.attrs(styles.dividerLine)} />
              <span {...stylex.attrs(styles.dividerText)}>{t('login.oauthDivider')}</span>
              <div {...stylex.attrs(styles.dividerLine)} />
            </div>
            <div {...stylex.attrs(styles.oauthButtons)}>
              <For each={providers()}>
                {(p) => (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin(p.name)}
                    {...stylex.attrs(controls.button, controls.buttonOutline, styles.oauthButton)}
                  >
                    {t('login.oauthButton', { provider: p.name })}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <p {...stylex.attrs(styles.footer)}>
          {t('login.noAccount')}{' '}
          <Link to={ROUTES.register} class={stylex.attrs(controls.link).class}>
            {t('login.toRegister')}
          </Link>
        </p>
      </div>
    </div>
  );
}
