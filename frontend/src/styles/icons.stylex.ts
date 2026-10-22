import * as stylex from '@stylexjs/stylex';
import { space } from './tokens.stylex';

/** Shared Lucide icon sizes. */
export const icons = stylex.create({
  xs: {
    width: space.px14,
    height: space.px14,
  },
  sm: {
    width: space.px16,
    height: space.px16,
  },
  md: {
    width: space.px20,
    height: space.px20,
  },
  lg: {
    width: space.px32,
    height: space.px32,
  },
});
