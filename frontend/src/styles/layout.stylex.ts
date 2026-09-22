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
});
