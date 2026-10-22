import * as stylex from '@stylexjs/stylex';
import { Show, createSignal } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import { t } from '@/i18n';
import type { ApiKeyCreatedResponse } from '@/api/schemas/auth';
import { controls } from '@/styles/controls.stylex';
import { feedback } from '@/styles/feedback.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { colors, radius, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

const styles = stylex.create({
  row: {
    marginBottom: space.px12,
  },
  code: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.green200,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px8,
    wordBreak: 'break-all',
  },
  copyBtn: {
    gap: space.px4,
    paddingInline: space.px12,
    fontWeight: 400,
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
    <div {...stylex.attrs(feedback.successBox)}>
      <h3 {...stylex.attrs(feedback.successTitle, layout.mb8)}>
        {t('apiKeyReveal.title')}
      </h3>
      <div {...stylex.attrs(layout.rowCenter8, styles.row)}>
        <code {...stylex.attrs(typography.body, layout.flex1, styles.code)}>
          {props.created.apiKey}
        </code>
        <button
          type="button"
          onClick={copy}
          {...stylex.attrs(controls.button, controls.buttonOutline, styles.copyBtn)}
        >
          <Show
            when={copied()}
            fallback={<Copy class={stylex.attrs(icons.sm).class} />}
          >
            <Check class={stylex.attrs(icons.sm, styles.copiedIcon).class} />
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
