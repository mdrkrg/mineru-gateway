import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight } from 'lucide-solid';
import { t } from '@/i18n';
import { controls } from '@/styles/controls.stylex';
import { colors, fontSize, lineHeight, space } from '@/styles/tokens.stylex';

interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px12,
  },
  btn: {
    gap: space.px4,
    paddingInline: space.px12,
    paddingBlock: space.px6,
    fontWeight: 400,
    opacity: {
      ':disabled': 0.4,
    },
  },
  info: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray600,
  },
  icon: {
    width: space.px16,
    height: space.px16,
  },
});

/** Simple prev/next pager with a page indicator. */
export default function Pagination(props: PaginationProps) {
  const totalPages = () => Math.max(1, Math.ceil(props.total / props.pageSize));

  return (
    <div {...stylex.attrs(styles.root)}>
      <button
        type="button"
        {...stylex.attrs(controls.button, controls.buttonOutline, styles.btn)}
        disabled={props.page <= 1}
        onClick={() => props.onChange(props.page - 1)}
      >
        <ChevronLeft class={stylex.attrs(styles.icon).class} />
        {t('pagination.prev')}
      </button>
      <span {...stylex.attrs(styles.info)}>
        {t('pagination.info', {
          page: props.page,
          totalPages: totalPages(),
          total: props.total,
        })}
      </span>
      <button
        type="button"
        {...stylex.attrs(controls.button, controls.buttonOutline, styles.btn)}
        disabled={props.page >= totalPages()}
        onClick={() => props.onChange(props.page + 1)}
      >
        {t('pagination.next')}
        <ChevronRight class={stylex.attrs(styles.icon).class} />
      </button>
    </div>
  );
}
