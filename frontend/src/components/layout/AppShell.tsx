import * as stylex from '@stylexjs/stylex';
import type { JSX } from 'solid-js';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import { colors, space } from '@/styles/tokens.stylex';

const styles = stylex.create({
  shell: {
    minHeight: '100vh',
    display: 'flex',
    backgroundColor: colors.gray50,
  },
  content: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  main: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    padding: space.px24,
    overflowY: 'auto',
  },
});

/**
 * Authenticated application chrome: sidebar navigation on the left,
 * header with breadcrumb + user menu on top, page content in the main area.
 */
export default function AppShell(props: { children: JSX.Element }) {
  return (
    <div {...stylex.attrs(styles.shell)}>
      <Sidebar />
      <div {...stylex.attrs(styles.content)}>
        <Header />
        <main {...stylex.attrs(styles.main)}>{props.children}</main>
      </div>
    </div>
  );
}
