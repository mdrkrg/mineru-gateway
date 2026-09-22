import * as stylex from '@stylexjs/stylex';
import { For } from 'solid-js';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-solid';
import { t } from '@/i18n';
import { useToast } from '@/stores/toast-context';
import type { ToastVariant } from '@/stores/toast';
import {
  colors,
  fontSize,
  lineHeight,
  radius,
  shadow,
  space,
} from '@/styles/tokens.stylex';

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
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
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
    width: space.px16,
    height: space.px16,
    flexShrink: 0,
  },
  message: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowWrap: 'break-word',
  },
  dismiss: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    color: colors.gray400,
    ':hover': {
      color: colors.gray600,
    },
  },
  dismissIcon: {
    width: space.px16,
    height: space.px16,
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
            <div {...stylex.attrs(styles.item, VARIANT_STYLES[toastItem.variant])}>
              <Icon class={stylex.attrs(styles.icon).class} />
              <span {...stylex.attrs(styles.message)}>{toastItem.message}</span>
              <button
                type="button"
                onClick={() => toast.dismiss(toastItem.id)}
                aria-label={t('toast.dismiss')}
                {...stylex.attrs(styles.dismiss)}
              >
                <X class={stylex.attrs(styles.dismissIcon).class} />
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
}
