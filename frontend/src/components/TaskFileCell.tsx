import * as stylex from '@stylexjs/stylex';
import { Show } from 'solid-js';
import { Link } from '@tanstack/solid-router';
import { ROUTES } from '@/utils/constants';
import { taskIdRef } from '@/utils/format';
import { controls } from '@/styles/controls.stylex';
import { colors, fontSize, lineHeight, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

const styles = stylex.create({
  count: {
    marginLeft: space.px4,
    color: colors.gray500,
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
  },
  shortId: {
    display: 'block',
    marginTop: space.px2,
    color: colors.gray400,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
  },
});

/**
 * Files cell shared by the task list's table and its phone rows.
 *
 * The file name is the human entry point into the task detail. UUIDv7 task
 * ids share a timestamp prefix, so the list shows the random suffix instead
 * of the full id; hovering it reveals the canonical UUID.
 */
export default function TaskFileCell(props: {
  taskId: string;
  fileNames: readonly string[];
  /** Hide the short id line; dense lists show it in their meta row. */
  compact?: boolean;
}) {
  const primaryName = () => props.fileNames[0] ?? '—';

  return (
    <>
      <Link
        to={ROUTES.taskDetail(props.taskId)}
        title={props.fileNames.join(', ')}
        class={stylex.attrs(controls.link, typography.body).class}
      >
        {primaryName()}
      </Link>
      <Show when={props.fileNames.length > 1}>
        <span {...stylex.attrs(styles.count)}>+{props.fileNames.length - 1}</span>
      </Show>
      <Show when={!props.compact}>
        <span {...stylex.attrs(styles.shortId)} title={props.taskId}>
          {taskIdRef(props.taskId)}
        </span>
      </Show>
    </>
  );
}
