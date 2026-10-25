import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, maxWidth, radius, shadow, space } from './tokens.stylex';

export const table = stylex.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.px8,
    boxShadow: shadow.base,
    overflowX: 'auto',
  },
  message: {
    padding: space.px24,
    color: colors.gray500,
  },
  root: {
    width: '100%',
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
  },
  headRow: {
    textAlign: 'left',
    color: colors.gray500,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.gray200,
  },
  thCheck: {
    paddingBlock: space.px8,
    paddingInlineStart: space.px16,
    paddingInlineEnd: space.px8,
    width: space.px32,
  },
  th: {
    paddingBlock: space.px8,
    paddingInlineEnd: space.px16,
    fontWeight: 500,
  },
  row: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.gray200,
    backgroundColor: {
      ':hover': colors.gray50,
    },
  },
  rowStatic: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.gray200,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  thEnd: {
    paddingBlock: space.px8,
    fontWeight: 500,
  },
  tdCheck: {
    paddingBlock: space.px8,
    paddingInlineStart: space.px16,
    paddingInlineEnd: space.px8,
  },
  td: {
    paddingBlock: space.px8,
    paddingInlineEnd: space.px16,
  },
  tdEnd: {
    paddingBlock: space.px8,
  },
  truncate: {
    paddingBlock: space.px8,
    paddingInlineEnd: space.px16,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  truncateNarrow: {
    maxWidth: maxWidth.px192,
  },
  truncateWide: {
    maxWidth: maxWidth.px256,
  },
  nowrap: {
    paddingBlock: space.px8,
    paddingInlineEnd: space.px16,
    whiteSpace: 'nowrap',
  },
});
