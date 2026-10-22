import * as stylex from '@stylexjs/stylex';
import type { JSX } from 'solid-js';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import { layout } from '@/styles/layout.stylex';
import { colors, space } from '@/styles/tokens.stylex';

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
  },
  main: {
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
      <div {...stylex.attrs(layout.flex1, styles.content)}>
        <Header />
        <main {...stylex.attrs(layout.flex1, styles.main)}>{props.children}</main>
      </div>
    </div>
  );
}
