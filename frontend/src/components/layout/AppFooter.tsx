import * as stylex from '@stylexjs/stylex';
import { GitBranch, Scale } from 'lucide-solid';
import { t } from '@/i18n';
import { LICENSE_URL, SOURCE_URL } from '@/utils/constants';
import { icons } from '@/styles/icons.stylex';
import { typography } from '@/styles/typography.stylex';
import { breakpoint, colors, space } from '@/styles/tokens.stylex';

const styles = stylex.create({
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.px16,
    // The phone navigation FAB floats over the bottom-right corner.
    paddingInlineStart: { default: space.px16, [breakpoint.sm]: space.px24 },
    paddingInlineEnd: { default: space.px72, [breakpoint.lg]: space.px24 },
    paddingBlock: space.px12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.gray200,
    backgroundColor: colors.white,
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.px4,
    color: colors.gray500,
    textDecorationLine: 'none',
    ':hover': {
      color: colors.gray700,
      textDecorationLine: 'underline',
    },
  },
});

/**
 * Source-code and license links, shown on every authenticated page.
 */
export default function AppFooter() {
  return (
    <footer {...stylex.attrs(styles.footer)}>
      <a
        href={SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        {...stylex.attrs(typography.metaFaint, styles.link)}
      >
        <GitBranch class={stylex.attrs(icons.xs).class} />
        {t('footer.source')}
      </a>
      <a
        href={LICENSE_URL}
        target="_blank"
        rel="noreferrer"
        {...stylex.attrs(typography.metaFaint, styles.link)}
      >
        <Scale class={stylex.attrs(icons.xs).class} />
        {t('footer.license')}
      </a>
    </footer>
  );
}
