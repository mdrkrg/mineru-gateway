import * as stylex from '@stylexjs/stylex';
import { Link, Outlet, createRootRoute } from '@tanstack/solid-router';
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools';
import ConfirmDialogHost from '../components/ConfirmDialogHost';
import ToastHost from '../components/ToastHost';
import { t } from '@/i18n';
import type { AuthStore } from '../stores/auth';
import { controls } from '@/styles/controls.stylex';
import { layout } from '@/styles/layout.stylex';
import { colors, fontSize, lineHeight, space } from '@/styles/tokens.stylex';

const styles = stylex.create({
  pendingText: {
    color: colors.gray500,
  },
  notFound: {
    padding: space.px32,
    textAlign: 'center',
  },
  notFoundTitle: {
    fontSize: fontSize.px24,
    lineHeight: lineHeight.px32,
    fontWeight: 700,
    marginBottom: space.px16,
  },
});

export const Route = createRootRoute({
  beforeLoad: ({ context }) => {
    return (context as { auth: AuthStore }).auth.init();
  },
  component: RootComponent,
  pendingComponent: () => (
    <div {...stylex.attrs(layout.centeredPage)}>
      <p {...stylex.attrs(styles.pendingText)}>{t('common.loading')}</p>
    </div>
  ),
  notFoundComponent: () => {
    return (
      <div {...stylex.attrs(styles.notFound)}>
        <h1 {...stylex.attrs(styles.notFoundTitle)}>{t('root.notFound')}</h1>
        <Link to="/" class={stylex.attrs(controls.link).class}>
          {t('root.goHome')}
        </Link>
      </div>
    );
  },
});

function RootComponent() {
  return (
    <>
      <Outlet />
      <ToastHost />
      <ConfirmDialogHost />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  );
}
