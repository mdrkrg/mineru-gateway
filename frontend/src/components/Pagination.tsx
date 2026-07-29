import { ChevronLeft, ChevronRight } from 'lucide-solid';

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

  const btn =
    'flex items-center gap-1 border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';

  return (
    <div class="flex items-center gap-3">
      <button
        type="button"
        class={btn}
        disabled={props.page <= 1}
        onClick={() => props.onChange(props.page - 1)}
      >
        <ChevronLeft class="w-4 h-4" />
        上一页
      </button>
      <span class="text-sm text-gray-600">
        第 {props.page} / {totalPages()} 页 · 共 {props.total} 条
      </span>
      <button
        type="button"
        class={btn}
        disabled={props.page >= totalPages()}
        onClick={() => props.onChange(props.page + 1)}
      >
        下一页
        <ChevronRight class="w-4 h-4" />
      </button>
    </div>
  );
}
