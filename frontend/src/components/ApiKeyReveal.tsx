import * as stylex from '@stylexjs/stylex';
import { Show, createSignal } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import { t } from '@/i18n';
import type { ApiKeyCreatedResponse } from '@/api/schemas/auth';
import { controls } from '@/styles/controls.stylex';
import {
  colors,
  fontSize,
  lineHeight,
  radius,
  space,
} from '@/styles/tokens.stylex';

const styles = stylex.create({
  card: {
    backgroundColor: colors.green50,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.green300,
    borderRadius: radius.px8,
    padding: space.px16,
  },
  title: {
    fontWeight: 600,
    color: colors.green800,
    marginBottom: space.px8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px8,
    marginBottom: space.px12,
  },
  code: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.green200,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px8,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    wordBreak: 'break-all',
  },
  copyBtn: {
    gap: space.px4,
    paddingInline: space.px12,
    fontWeight: 400,
  },
  icon: {
    width: space.px16,
    height: space.px16,
  },
  copiedIcon: {
    color: colors.green600,
  },
});

/**
 * One-time reveal of a freshly created API key. The full key is only
 * returned at creation time, so this block pushes the user to copy it
 * immediately. Optionally offers an action to mark it active locally.
 */
export default function ApiKeyReveal(props: {
  created: ApiKeyCreatedResponse;
  onUseKey?: (key: string) => void;
}) {
  const [copied, setCopied] = createSignal(false);

  async function copy() {
    await navigator.clipboard.writeText(props.created.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div {...stylex.attrs(styles.card)}>
      <h3 {...stylex.attrs(styles.title)}>{t('apiKeyReveal.title')}</h3>
      <div {...stylex.attrs(styles.row)}>
        <code {...stylex.attrs(styles.code)}>{props.created.apiKey}</code>
        <button
          type="button"
          onClick={copy}
          {...stylex.attrs(controls.button, controls.buttonOutline, styles.copyBtn)}
        >
          <Show
            when={copied()}
            fallback={<Copy class={stylex.attrs(styles.icon).class} />}
          >
            <Check class={stylex.attrs(styles.icon, styles.copiedIcon).class} />
          </Show>
          {copied() ? t('apiKeyReveal.copied') : t('apiKeyReveal.copy')}
        </button>
      </div>
      <Show when={props.onUseKey}>
        {(use) => (
          <button
            type="button"
            onClick={() => use()(props.created.apiKey)}
            {...stylex.attrs(controls.button, controls.buttonPrimary)}
          >
            {t('apiKeyReveal.useHere')}
          </button>
        )}
      </Show>
    </div>
  );
}
