import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, radius, shadow, space } from './tokens.stylex';

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
    borderBottomColor: 'currentColor',
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
    borderBottomColor: 'currentColor',
    backgroundColor: {
      ':hover': colors.gray50,
    },
  },
  lastRow: {
    borderBottomWidth: 0,
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
  link: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
  },
  code: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
  },
  truncate: {
    paddingBlock: space.px8,
    paddingInlineEnd: space.px16,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  truncateNarrow: {
    maxWidth: space.px192,
  },
  truncateWide: {
    maxWidth: space.px256,
  },
  nowrap: {
    paddingBlock: space.px8,
    paddingInlineEnd: space.px16,
    whiteSpace: 'nowrap',
  },
});

export const actionButton = stylex.create({
  refresh: {
    fontWeight: 400,
    paddingInline: space.px12,
    paddingBlock: space.px6,
  },
  danger: {
    borderColor: colors.red300,
    color: colors.red600,
    backgroundColor: {
      default: 'transparent',
      ':enabled:hover': colors.red50,
    },
    paddingInline: space.px12,
    paddingBlock: space.px6,
    fontWeight: 400,
    opacity: {
      ':disabled': 0.4,
    },
  },
});
