import * as stylex from '@stylexjs/stylex';
import { Show, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { ShieldCheck } from 'lucide-solid';
import { t } from '@/i18n';
import { useAdminToken } from '@/stores/admin-token-context';
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { forms } from '@/styles/forms.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { colors, maxWidth, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

const styles = stylex.create({
  card: {
    maxWidth: maxWidth.px448,
  },
  clear: {
    marginLeft: space.px8,
    color: colors.red500,
  },
});

/**
 * Gates admin pages behind the gateway admin token (`X-Admin-Token`).
 *
 * The token is tab-scoped (sessionStorage), so it must be entered once per
 * tab. Once set, the wrapped content is rendered and the gate stays
 * transparent.
 */
export default function AdminTokenGate(props: { children: JSX.Element }) {
  const store = useAdminToken();
  const [input, setInput] = createSignal('');

  return (
    <Show
      when={store.token()}
      fallback={
        <div {...stylex.attrs(controls.card, styles.card)}>
          <h2
            {...stylex.attrs(
              layout.rowCenter8,
              typography.sectionTitleCompact,
            )}
          >
            <ShieldCheck class={stylex.attrs(icons.md).class} />
            {t('adminGate.title')}
          </h2>
          <p {...stylex.attrs(typography.bodyMuted, layout.mb16)}>
            {t('adminGate.description')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const token = input().trim();
              if (token) {
                store.setToken(token);
                setInput('');
              }
            }}
            {...stylex.attrs(forms.rowTight)}
          >
            <label {...stylex.attrs(controls.field, layout.flex1)}>
              <span {...stylex.attrs(controls.fieldLabel)}>{t('adminGate.tokenLabel')}</span>
              <input
                type="password"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                {...stylex.attrs(controls.input)}
              />
            </label>
            <button
              type="submit"
              {...stylex.attrs(controls.button, controls.buttonPrimary)}
            >
              {t('adminGate.submit')}
            </button>
          </form>
        </div>
      }
    >
      <div {...stylex.attrs(layout.stack16)}>
        <p {...stylex.attrs(typography.metaFaint)}>
          {t('adminGate.setNotice')}
          <button
            type="button"
            onClick={() => store.clearToken()}
            {...stylex.attrs(actions.clear, styles.clear)}
          >
            {t('common.clear')}
          </button>
        </p>
        {props.children}
      </div>
    </Show>
  );
}
