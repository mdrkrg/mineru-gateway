import * as stylex from '@stylexjs/stylex';
import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { useLocation } from '@tanstack/solid-router';
import { Popover } from '@kobalte/core/popover';
import { Menu, X } from 'lucide-solid';
import AppFooter from '@/components/layout/AppFooter';
import Header from '@/components/layout/Header';
import Sidebar, { SidebarNav } from '@/components/layout/Sidebar';
import { t } from '@/i18n';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import {
  breakpoint,
  colors,
  motion,
  radius,
  shadow,
  space,
} from '@/styles/tokens.stylex';

const menuIn = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(0.5rem) scale(0.98)' },
  to: { opacity: 1, transform: 'translateY(0) scale(1)' },
});

const menuOut = stylex.keyframes({
  from: { opacity: 1, transform: 'translateY(0) scale(1)' },
  to: { opacity: 0, transform: 'translateY(0.5rem) scale(0.98)' },
});

const styles = stylex.create({
  shell: {
    minHeight: '100vh',
    display: 'flex',
    backgroundColor: colors.gray50,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  page: {
    paddingInline: {
      default: space.px16,
      [breakpoint.sm]: space.px24,
    },
    paddingTop: {
      default: space.px16,
      [breakpoint.sm]: space.px24,
    },
    paddingBottom: {
      default: space.px72,
      [breakpoint.lg]: space.px24,
    },
  },
  fab: {
    position: 'fixed',
    right: space.px16,
    bottom: space.px16,
    zIndex: 40,
    display: { default: 'inline-flex', [breakpoint.lg]: 'none' },
    alignItems: 'center',
    justifyContent: 'center',
    width: space.px56,
    height: space.px56,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.px8,
    backgroundColor: {
      default: colors.gray800,
      ':hover': colors.gray700,
    },
    color: colors.white,
    boxShadow: shadow.lg,
    cursor: 'pointer',
  },
  mobileMenu: {
    width: space.px224,
    maxHeight: 'min(70vh, 24rem)',
    overflowY: 'auto',
    backgroundColor: colors.gray800,
    borderRadius: radius.px8,
    boxShadow: shadow.lg,
    transformOrigin: 'bottom right',
  },
  menuOpen: {
    animationName: menuIn,
    animationDuration: motion.duration,
    animationTimingFunction: motion.easing,
  },
  menuClosed: {
    animationName: menuOut,
    animationDuration: motion.duration,
    animationTimingFunction: motion.easing,
    animationFillMode: 'forwards',
  },
});

/**
 * Authenticated application chrome: desktop sidebar on the left, mobile
 * floating navigation menu, header with breadcrumb + user menu on top,
 * page content in the main area.
 */
export default function AppShell(props: { children: JSX.Element }) {
  const location = useLocation();
  const desktop = window.matchMedia('(min-width: 64rem)');
  const [isDesktop, setIsDesktop] = createSignal(desktop.matches);
  const [isMenuOpen, setMenuOpen] = createSignal(false);

  // Close the floating menu whenever the route changes.
  createEffect(() => {
    location().pathname;
    setMenuOpen(false);
  });

  onMount(() => {
    const onViewportChange = () => {
      setIsDesktop(desktop.matches);
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', onViewportChange);
    onCleanup(() => desktop.removeEventListener('change', onViewportChange));
  });

  return (
    <div {...stylex.attrs(styles.shell)}>
      <Show
        when={isDesktop()}
        fallback={
          <Popover
            open={isMenuOpen()}
            onOpenChange={setMenuOpen}
            placement="top-end"
            gutter={12}
          >
            <Popover.Trigger
              type="button"
              aria-label={isMenuOpen() ? t('nav.closeMenu') : t('nav.openMenu')}
              class={stylex.attrs(styles.fab).class}
            >
              <Show
                when={isMenuOpen()}
                fallback={<Menu class={stylex.attrs(icons.md).class} />}
              >
                <X class={stylex.attrs(icons.md).class} />
              </Show>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                aria-label={t('nav.menu')}
                class={stylex.attrs(
                  styles.mobileMenu,
                  isMenuOpen() ? styles.menuOpen : styles.menuClosed,
                ).class}
              >
                <SidebarNav onNavigate={() => setMenuOpen(false)} />
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        }
      >
        <Sidebar />
      </Show>
      <div {...stylex.attrs(styles.content)}>
        <Header />
        <main {...stylex.attrs(layout.flex1, styles.main)}>
          <div {...stylex.attrs(layout.flex1, styles.page)}>{props.children}</div>
          {/* In the scroll flow: pinned to the viewport while the page is
              short, revealed at the end once it scrolls. */}
          <AppFooter />
        </main>
      </div>
    </div>
  );
}
