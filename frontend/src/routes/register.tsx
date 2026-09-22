import * as stylex from '@stylexjs/stylex';
import { Show, createSignal } from 'solid-js';
import { Link, createFileRoute, useNavigate } from '@tanstack/solid-router';
import { t } from '@/i18n';
import { register } from '@/api/functions/auth';
import { errorMessage } from '@/utils/api-error';
import { ROUTES } from '@/utils/constants';
import { onMount } from 'solid-js';
import { useAuth } from '@/stores/auth-context';
import { controls } from '@/styles/controls.stylex';
import { layout } from '@/styles/layout.stylex';
import {
  colors,
  fontSize,
  lineHeight,
  space,
} from '@/styles/tokens.stylex';

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});

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
  footer: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
    textAlign: 'center',
    marginTop: space.px16,
  },
  success: {
    textAlign: 'center',
  },
  successTitle: {
    fontSize: fontSize.px24,
    lineHeight: lineHeight.px32,
    fontWeight: 700,
    marginBottom: space.px8,
  },
  successBody: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray600,
    marginBottom: space.px24,
  },
  successEmail: {
    fontWeight: 500,
  },
});

function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [confirm, setConfirm] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = createSignal<string | null>(null);

  onMount(async () => {
    if (auth.isAuthenticated()) {
      navigate({ to: ROUTES.home });
    }
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);

    if (password() !== confirm()) {
      setError(t('register.errPasswordMismatch'));
      return;
    }

    setIsSubmitting(true);
    const result = await register({
      email: email(),
      password: password(),
      isActive: null,
      isSuperuser: null,
      isVerified: null,
      displayName: displayName().trim() || null,
    });
    setIsSubmitting(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }

    setRegisteredEmail(email());
  }

  return (
    <div {...stylex.attrs(layout.centeredPage)}>
      <div {...stylex.attrs(layout.panel)}>
        <Show
          when={registeredEmail()}
          fallback={
            <>
              <h1 {...stylex.attrs(styles.title)}>{t('register.title')}</h1>
              <p {...stylex.attrs(styles.subtitle)}>MinerU Gateway</p>

              <form onSubmit={handleSubmit} {...stylex.attrs(controls.form)}>
                <label {...stylex.attrs(controls.field)}>
                  <span {...stylex.attrs(controls.fieldLabel)}>{t('register.email')}</span>
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
                  <span {...stylex.attrs(controls.fieldLabel)}>{t('register.displayName')}</span>
                  <input
                    type="text"
                    autocomplete="nickname"
                    value={displayName()}
                    onInput={(e) => setDisplayName(e.currentTarget.value)}
                    {...stylex.attrs(controls.input)}
                  />
                </label>

                <label {...stylex.attrs(controls.field)}>
                  <span {...stylex.attrs(controls.fieldLabel)}>{t('register.password')}</span>
                  <input
                    type="password"
                    required
                    autocomplete="new-password"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    {...stylex.attrs(controls.input)}
                  />
                </label>

                <label {...stylex.attrs(controls.field)}>
                  <span {...stylex.attrs(controls.fieldLabel)}>
                    {t('register.confirmPassword')}
                  </span>
                  <input
                    type="password"
                    required
                    autocomplete="new-password"
                    value={confirm()}
                    onInput={(e) => setConfirm(e.currentTarget.value)}
                    {...stylex.attrs(controls.input)}
                  />
                </label>

                <Show when={error()}>
                  <p {...stylex.attrs(controls.errorText)}>{error()}</p>
                </Show>

                <button
                  type="submit"
                  disabled={isSubmitting()}
                  {...stylex.attrs(controls.button, controls.buttonPrimary, controls.buttonLarge)}
                >
                  {isSubmitting() ? t('register.submitting') : t('register.submit')}
                </button>
              </form>

              <p {...stylex.attrs(styles.footer)}>
                {t('register.hasAccount')}{' '}
                <Link to={ROUTES.login} class={stylex.attrs(controls.link).class}>
                  {t('register.toLogin')}
                </Link>
              </p>
            </>
          }
        >
          {(email) => (
            <div {...stylex.attrs(styles.success)}>
              <h1 {...stylex.attrs(styles.successTitle)}>{t('register.successTitle')}</h1>
              <p {...stylex.attrs(styles.successBody)}>
                {t('register.successPrefix')}
                <span {...stylex.attrs(styles.successEmail)}>{email()}</span>
                {t('register.successSuffix')}
              </p>
              <button
                type="button"
                onClick={() => navigate({ to: ROUTES.login })}
                {...stylex.attrs(controls.button, controls.buttonPrimary, controls.buttonLarge)}
              >
                {t('register.goLogin')}
              </button>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
