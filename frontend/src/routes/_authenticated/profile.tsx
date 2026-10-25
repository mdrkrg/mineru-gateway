import * as stylex from '@stylexjs/stylex';
import { Show, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { t } from '@/i18n';
import { updateCurrentUser } from '@/api/functions/auth';
import { useAuth } from '@/stores/auth-context';
import { errorMessage } from '@/utils/api-error';
import { formatDateTime } from '@/utils/format';
import { controls } from '@/styles/controls.stylex';
import { layout } from '@/styles/layout.stylex';
import { space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/profile')({
  component: ProfilePage,
});

const styles = stylex.create({
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: space.px16,
  },
});

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
      setError(t('profile.errPasswordMismatch'));
      return;
    }

    const name = displayName().trim();
    const currentName = auth.user()?.displayName ?? '';
    if (!password() && name === currentName) {
      setError(t('profile.errNoChanges'));
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
    <div {...stylex.attrs(layout.stack16, layout.pageWidth672)}>
      <section {...stylex.attrs(controls.card)}>
        <h2 {...stylex.attrs(typography.sectionTitle)}>{t('profile.accountInfo')}</h2>
        <dl {...stylex.attrs(typography.body, styles.infoGrid)}>
          <div>
            <dt {...stylex.attrs(typography.metaMuted, layout.mb2)}>
              {t('profile.email')}
            </dt>
            <dd>{auth.user()?.email}</dd>
          </div>
          <div>
            <dt {...stylex.attrs(typography.metaMuted, layout.mb2)}>
              {t('profile.role')}
            </dt>
            <dd>{auth.user()?.isSuperuser ? t('profile.roleAdmin') : t('profile.roleUser')}</dd>
          </div>
          <div>
            <dt {...stylex.attrs(typography.metaMuted, layout.mb2)}>
              {t('profile.emailVerification')}
            </dt>
            <dd>{auth.user()?.isVerified ? t('profile.verified') : t('profile.unverified')}</dd>
          </div>
          <div>
            <dt {...stylex.attrs(typography.metaMuted, layout.mb2)}>
              {t('profile.registeredAt')}
            </dt>
            <dd>{formatDateTime(auth.user()?.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section {...stylex.attrs(controls.card)}>
        <h2 {...stylex.attrs(typography.sectionTitle)}>{t('profile.editTitle')}</h2>

        <Show when={error()}>
          <p {...stylex.attrs(controls.alertError, layout.mb16)}>{error()}</p>
        </Show>
        <Show when={saved()}>
          <p {...stylex.attrs(controls.alertSuccess, layout.mb16)}>
            {t('profile.saved')}
          </p>
        </Show>

        <form onSubmit={handleSave} {...stylex.attrs(layout.stack16)}>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('profile.displayName')}</span>
            <input
              type="text"
              value={displayName()}
              onInput={(e) => setDisplayName(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            />
          </label>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('profile.newPassword')}</span>
            <input
              type="password"
              autocomplete="new-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            />
          </label>
          <Show when={password()}>
            <label {...stylex.attrs(controls.field)}>
              <span {...stylex.attrs(controls.fieldLabel)}>
                {t('profile.confirmNewPassword')}
              </span>
              <input
                type="password"
                autocomplete="new-password"
                value={confirm()}
                onInput={(e) => setConfirm(e.currentTarget.value)}
                {...stylex.attrs(controls.input)}
              />
            </label>
          </Show>
          <button
            type="submit"
            disabled={isSaving()}
            {...stylex.attrs(
              controls.button,
              controls.buttonPrimary,
              controls.buttonLarge,
              layout.selfStart,
            )}
          >
            {isSaving() ? t('profile.saving') : t('profile.save')}
          </button>
        </form>
      </section>
    </div>
  );
}
