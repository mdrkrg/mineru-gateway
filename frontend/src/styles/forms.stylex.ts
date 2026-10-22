import * as stylex from '@stylexjs/stylex';
import { fontSize, lineHeight, space } from './tokens.stylex';

/** Shared form layout primitives. */
export const forms = stylex.create({
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: space.px16,
  },
  rowTight: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: space.px8,
  },
  inputMedium: {
    width: space.px224,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px6,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
  },
  checkboxRow: {
    display: 'flex',
    gap: space.px24,
  },
});
