import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight } from 'lucide-solid';
import { t } from '@/i18n';
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { typography } from '@/styles/typography.stylex';

interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

/** Simple prev/next pager with a page indicator. */
export default function Pagination(props: PaginationProps) {
  const totalPages = () => Math.max(1, Math.ceil(props.total / props.pageSize));

  return (
    <div {...stylex.attrs(layout.rowCenter12)}>
      <button
        type="button"
        {...stylex.attrs(
          controls.button,
          controls.buttonOutline,
          actions.outlineCompact,
        )}
        disabled={props.page <= 1}
        onClick={() => props.onChange(props.page - 1)}
      >
        <ChevronLeft class={stylex.attrs(icons.sm).class} />
        {t('pagination.prev')}
      </button>
      <span {...stylex.attrs(typography.bodySecondary)}>
        {t('pagination.info', {
          page: props.page,
          totalPages: totalPages(),
          total: props.total,
        })}
      </span>
      <button
        type="button"
        {...stylex.attrs(
          controls.button,
          controls.buttonOutline,
          actions.outlineCompact,
        )}
        disabled={props.page >= totalPages()}
        onClick={() => props.onChange(props.page + 1)}
      >
        {t('pagination.next')}
        <ChevronRight class={stylex.attrs(icons.sm).class} />
      </button>
    </div>
  );
}
