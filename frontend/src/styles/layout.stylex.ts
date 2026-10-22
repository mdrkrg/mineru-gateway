import * as stylex from '@stylexjs/stylex';
import { colors, maxWidth, radius, shadow, space } from './tokens.stylex';

export const layout = stylex.create({
  centeredPage: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray50,
    paddingInline: space.px16,
  },
  panel: {
    width: '100%',
    maxWidth: maxWidth.px384,
    backgroundColor: colors.white,
    borderRadius: radius.px8,
    boxShadow: shadow.base,
    padding: space.px32,
  },
  stack8: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px8,
  },
  stack16: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px16,
  },
  stack24: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px24,
  },
  rowCenter8: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px8,
  },
  rowCenter12: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px12,
  },
  rowCenter16: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px16,
  },
  rowBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
  },
  flex1: {
    flex: 1,
  },
  fullWidth: {
    width: '100%',
  },
  selfStart: {
    alignSelf: 'flex-start',
  },
  textCenter: {
    textAlign: 'center',
  },
  mb2: {
    marginBottom: space.px2,
  },
  mb4: {
    marginBottom: space.px4,
  },
  mb8: {
    marginBottom: space.px8,
  },
  mb16: {
    marginBottom: space.px16,
  },
  mt8: {
    marginTop: space.px8,
  },
  mt16: {
    marginTop: space.px16,
  },
  noShrink: {
    flexShrink: 0,
  },
  transitionColors: {
    transitionProperty:
      'color, background-color, border-color, text-decoration-color, fill, stroke',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    transitionDuration: '150ms',
  },
});
