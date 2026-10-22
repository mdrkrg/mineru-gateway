import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, space } from './tokens.stylex';

/**
 * Shared text styles. Keep typography decisions here so pages and components
 * do not re-declare the same font-size/line-height/colour combinations.
 */
export const typography = stylex.create({
  body: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
  },
  bodySecondary: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray600,
  },
  bodyMuted: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
  },
  meta: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
  },
  metaMuted: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    color: colors.gray500,
  },
  metaFaint: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    color: colors.gray400,
  },
  muted: {
    color: colors.gray500,
  },
  faint: {
    color: colors.gray400,
  },
  emphasis: {
    fontWeight: 500,
  },
  pageTitle: {
    fontSize: fontSize.px20,
    lineHeight: lineHeight.px28,
    fontWeight: 700,
  },
  sectionHeading: {
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
  },
  sectionTitle: {
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
    marginBottom: space.px16,
  },
  sectionTitleCompact: {
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
    marginBottom: space.px8,
  },
  sectionTitleTight: {
    fontSize: fontSize.px18,
    lineHeight: lineHeight.px28,
    fontWeight: 600,
    marginBottom: space.px12,
  },
  subsectionTitle: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    fontWeight: 600,
    color: colors.gray500,
    marginBottom: space.px8,
  },
  heroTitle: {
    fontSize: fontSize.px24,
    lineHeight: lineHeight.px32,
    fontWeight: 700,
    textAlign: 'center',
    marginBottom: space.px8,
  },
});
