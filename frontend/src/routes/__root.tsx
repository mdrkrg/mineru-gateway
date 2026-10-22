import * as stylex from '@stylexjs/stylex';
import { Link, Outlet, createRootRoute } from '@tanstack/solid-router';
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools';
import ConfirmDialogHost from '../components/ConfirmDialogHost';
import ToastHost from '../components/ToastHost';
import { t } from '@/i18n';
import type { AuthStore } from '../stores/auth';
import { controls } from '@/styles/controls.stylex';
import { layout } from '@/styles/layout.stylex';
import { space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

const styles = stylex.create({
  notFound: {
    padding: space.px32,
    textAlign: 'center',
  },
});

export const Route = createRootRoute({
  beforeLoad: ({ context }) => {
    return (context as { auth: AuthStore }).auth.init();
  },
  component: RootComponent,
  pendingComponent: () => (
    <div {...stylex.attrs(layout.centeredPage)}>
      <p {...stylex.attrs(typography.muted)}>{t('common.loading')}</p>
    </div>
  ),
  notFoundComponent: () => {
    return (
      <div {...stylex.attrs(styles.notFound)}>
        <h1 {...stylex.attrs(typography.heroTitle, layout.mb16)}>
          {t('root.notFound')}
        </h1>
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
