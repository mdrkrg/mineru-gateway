import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, radius, space } from './tokens.stylex';

/** Shared pill/badge styles for task and API-key statuses. */
export const badges = stylex.create({
  pill: {
    display: 'inline-block',
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    borderRadius: radius.px4,
    paddingInline: space.px6,
    paddingBlock: space.px2,
    whiteSpace: 'nowrap',
  },
  pending: {
    backgroundColor: colors.yellow100,
    color: colors.yellow700,
  },
  blue: {
    backgroundColor: colors.blue100,
    color: colors.blue700,
  },
  retryPending: {
    backgroundColor: colors.orange100,
    color: colors.orange700,
  },
  green: {
    backgroundColor: colors.green100,
    color: colors.green700,
  },
  failed: {
    backgroundColor: colors.red100,
    color: colors.red700,
  },
  gray: {
    backgroundColor: colors.gray100,
    color: colors.gray500,
  },
  fallback: {
    backgroundColor: colors.gray100,
    color: colors.gray600,
  },
  inUse: {
    marginInlineStart: space.px8,
  },
});
