import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, maxWidth, radius, shadow, space } from './tokens.stylex';

/** Shared dialog chrome for the confirm and email-verification modals. */
export const modal = stylex.create({
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    backgroundColor: 'rgb(0 0 0 / 40%)',
  },
  overlayCentered: {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgb(0 0 0 / 40%)',
    paddingInline: space.px16,
  },
  dialogFixed: {
    position: 'fixed',
    left: '50%',
    top: '50%',
    translate: '-50% -50%',
    zIndex: 50,
  },
  dialog: {
    width: '100%',
    maxWidth: maxWidth.px384,
    backgroundColor: colors.white,
    borderRadius: radius.px8,
    boxShadow: shadow.xl,
    padding: space.px24,
  },
  dialogWide: {
    width: '100%',
    maxWidth: maxWidth.px448,
    backgroundColor: colors.white,
    borderRadius: radius.px8,
    boxShadow: shadow.xl,
    padding: space.px24,
  },
  titleStrong: {
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
    color: colors.gray900,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: space.px12,
  },
  actions: {
    marginTop: space.px24,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: space.px12,
  },
});
