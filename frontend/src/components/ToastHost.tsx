import * as stylex from '@stylexjs/stylex';
import { For } from 'solid-js';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-solid';
import { t } from '@/i18n';
import { useToast } from '@/stores/toast-context';
import type { ToastVariant } from '@/stores/toast';
import { controls } from '@/styles/controls.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { colors, radius, shadow, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

const styles = stylex.create({
  root: {
    position: 'fixed',
    bottom: space.px16,
    right: space.px16,
    zIndex: 50,
    display: 'flex',
    width: space.px320,
    flexDirection: 'column',
    gap: space.px8,
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.px8,
    borderRadius: radius.px8,
    borderWidth: 1,
    borderStyle: 'solid',
    paddingInline: space.px16,
    paddingBlock: space.px12,
    boxShadow: shadow.lg,
  },
  success: {
    borderColor: colors.green300,
    backgroundColor: colors.green50,
    color: colors.green800,
  },
  error: {
    borderColor: colors.red300,
    backgroundColor: colors.red50,
    color: colors.red700,
  },
  info: {
    borderColor: colors.gray300,
    backgroundColor: colors.white,
    color: colors.gray700,
  },
  icon: {
    marginTop: space.px2,
  },
  message: {
    overflowWrap: 'break-word',
  },
});

const VARIANT_STYLES: Record<ToastVariant, stylex.StyleXStyles> = {
  success: styles.success,
  error: styles.error,
  info: styles.info,
};

const VARIANT_ICON = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
} as const;

/**
 * Renders the active toasts as a fixed bottom-right overlay. Mounted once
 * near the router root so feedback is visible on every route.
 */
export default function ToastHost() {
  const toast = useToast();

  return (
    <div {...stylex.attrs(styles.root)} role="status" aria-live="polite">
      <For each={toast.toasts()}>
        {(toastItem) => {
          const Icon = VARIANT_ICON[toastItem.variant];
          return (
            <div
              {...stylex.attrs(
                typography.body,
                styles.item,
                VARIANT_STYLES[toastItem.variant],
              )}
            >
              <Icon class={stylex.attrs(icons.sm, layout.noShrink, styles.icon).class} />
              <span {...stylex.attrs(layout.flex1, styles.message)}>{toastItem.message}</span>
              <button
                type="button"
                onClick={() => toast.dismiss(toastItem.id)}
                aria-label={t('toast.dismiss')}
                {...stylex.attrs(controls.iconButton)}
              >
                <X class={stylex.attrs(icons.sm).class} />
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
}
