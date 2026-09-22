import * as stylex from '@stylexjs/stylex';
import { Show, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { ShieldCheck } from 'lucide-solid';
import { t } from '@/i18n';
import { useAdminToken } from '@/stores/admin-token-context';
import { controls } from '@/styles/controls.stylex';
import {
  colors,
  fontSize,
  lineHeight,
  maxWidth,
  space,
} from '@/styles/tokens.stylex';

const styles = stylex.create({
  card: {
    maxWidth: maxWidth.px448,
  },
  heading: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px8,
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
    marginBottom: space.px8,
  },
  headingIcon: {
    width: space.px20,
    height: space.px20,
  },
  description: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
    marginBottom: space.px16,
  },
  form: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: space.px8,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px4,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  fieldLabel: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    fontWeight: 500,
    color: colors.gray700,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px16,
  },
  notice: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    color: colors.gray400,
  },
  clear: {
    marginLeft: space.px8,
    color: colors.red500,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    ':hover': {
      textDecorationLine: 'underline',
    },
  },
});

/**
 * Gates admin pages behind the gateway admin token (`X-Admin-Token`).
 * When no token is set, renders an input form; otherwise renders the
 * children plus a small "clear token" affordance.
 */
export default function AdminTokenGate(props: { children: JSX.Element }) {
  const store = useAdminToken();
  const [input, setInput] = createSignal('');

  return (
    <Show
      when={store.token()}
      fallback={
        <div {...stylex.attrs(controls.card, styles.card)}>
          <h2 {...stylex.attrs(styles.heading)}>
            <ShieldCheck class={stylex.attrs(styles.headingIcon).class} />
            {t('adminGate.title')}
          </h2>
          <p {...stylex.attrs(styles.description)}>{t('adminGate.description')}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = input().trim();
              if (t) {
                store.setToken(t);
                setInput('');
              }
            }}
            {...stylex.attrs(styles.form)}
          >
            <label {...stylex.attrs(styles.field)}>
              <span {...stylex.attrs(styles.fieldLabel)}>{t('adminGate.tokenLabel')}</span>
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
      <div {...stylex.attrs(styles.content)}>
        <p {...stylex.attrs(styles.notice)}>
          {t('adminGate.setNotice')}
          <button
            type="button"
            onClick={() => store.clearToken()}
            {...stylex.attrs(styles.clear)}
          >
            {t('common.clear')}
          </button>
        </p>
        {props.children}
      </div>
    </Show>
  );
}
