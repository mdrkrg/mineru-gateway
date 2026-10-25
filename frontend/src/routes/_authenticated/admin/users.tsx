import * as stylex from '@stylexjs/stylex';
import { Show, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { adminCreateUser } from '@/api/functions/auth';
import type { UserRead } from '@/api/schemas/auth';
import AdminTokenGate from '@/components/AdminTokenGate';
import { t } from '@/i18n';
import type { AuthStore } from '@/stores/auth';
import { useAdminToken } from '@/stores/admin-token-context';
import { useToast } from '@/stores/toast-context';
import { requireSuperuser } from '@/stores/guard';
import { errorMessage } from '@/utils/api-error';
import { controls } from '@/styles/controls.stylex';
import { feedback } from '@/styles/feedback.stylex';
import { forms } from '@/styles/forms.stylex';
import { layout } from '@/styles/layout.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/admin/users')({
  beforeLoad: ({ context }) => {
    requireSuperuser((context as { auth: AuthStore }).auth);
  },
  component: AdminUsersPage,
});

function AdminUsersPage() {
  return (
    <AdminTokenGate>
      <AdminUsersContent />
    </AdminTokenGate>
  );
}

function AdminUsersContent() {
  const adminToken = useAdminToken();
  const toast = useToast();

  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [isSuperuser, setIsSuperuser] = createSignal(false);
  const [isCreating, setIsCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [created, setCreated] = createSignal<UserRead | null>(null);

  async function handleCreate(e: SubmitEvent) {
    e.preventDefault();
    const token = adminToken.token();
    if (!token) return;

    setIsCreating(true);
    setError(null);
    setCreated(null);

    const result = await adminCreateUser(
      {
        email: email(),
        password: password(),
        displayName: displayName().trim() || null,
        isActive: null,
        isSuperuser: isSuperuser(),
        isVerified: null,
      },
      token,
    );
    setIsCreating(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }

    setCreated(result.value);
    setEmail('');
    setPassword('');
    setDisplayName('');
    setIsSuperuser(false);
    toast.show(t('adminUsers.createdTitle'), 'success');
  }

  return (
    <div {...stylex.attrs(layout.stack16, layout.pageWidth576)}>
      <Show when={error()}>
        <p {...stylex.attrs(controls.alertError)}>{error()}</p>
      </Show>

      <Show when={created()}>
        {(u) => (
          <div {...stylex.attrs(feedback.successBox)}>
            <h3 {...stylex.attrs(feedback.successTitle)}>{t('adminUsers.createdTitle')}</h3>
            <p {...stylex.attrs(feedback.successText)}>
              {u().email}
              {u().displayName ? t('adminUsers.nameSuffix', { name: u().displayName ?? '' }) : ''}
              {u().isSuperuser ? t('adminUsers.superuserTag') : ''}
            </p>
          </div>
        )}
      </Show>

      <section {...stylex.attrs(controls.card)}>
        <h2 {...stylex.attrs(typography.sectionHeading, layout.mb16)}>{t('adminUsers.createTitle')}</h2>
        <form onSubmit={handleCreate} {...stylex.attrs(layout.stack16)}>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('adminUsers.email')}</span>
            <input
              type="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            />
          </label>
          <label {...stylex.attrs(controls.field)}>
            <span {...stylex.attrs(controls.fieldLabel)}>{t('adminUsers.initialPassword')}</span>
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
            <span {...stylex.attrs(controls.fieldLabel)}>{t('adminUsers.displayName')}</span>
            <input
              type="text"
              value={displayName()}
              onInput={(e) => setDisplayName(e.currentTarget.value)}
              {...stylex.attrs(controls.input)}
            />
          </label>
          <div {...stylex.attrs(forms.checkboxRow)}>
            <label {...stylex.attrs(forms.checkboxLabel)}>
              <input
                type="checkbox"
                checked={isSuperuser()}
                onChange={(e) => setIsSuperuser(e.currentTarget.checked)}
              />
              {t('adminUsers.superuser')}
            </label>
          </div>
          <button
            type="submit"
            disabled={isCreating()}
            {...stylex.attrs(
              controls.button,
              controls.buttonPrimary,
              controls.buttonLarge,
              layout.selfStart,
            )}
          >
            {isCreating() ? t('adminUsers.creating') : t('adminUsers.submit')}
          </button>
        </form>
      </section>
    </div>
  );
}
