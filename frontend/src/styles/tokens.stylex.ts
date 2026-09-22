import * as stylex from '@stylexjs/stylex';

export const colors = stylex.defineConsts({
  white: '#fff',
  black: '#000',

  gray50: 'oklch(98.5% 0.002 247.839)',
  gray100: 'oklch(96.7% 0.003 264.542)',
  gray200: 'oklch(92.8% 0.006 264.531)',
  gray300: 'oklch(87.2% 0.01 258.338)',
  gray400: 'oklch(70.7% 0.022 261.325)',
  gray500: 'oklch(55.1% 0.027 264.364)',
  gray600: 'oklch(44.6% 0.03 256.802)',
  gray700: 'oklch(37.3% 0.034 259.733)',
  gray800: 'oklch(27.8% 0.033 256.848)',
  gray900: 'oklch(21% 0.034 264.665)',

  blue50: 'oklch(97% 0.014 254.604)',
  blue100: 'oklch(93.2% 0.032 255.585)',
  blue400: 'oklch(70.7% 0.165 254.624)',
  blue500: 'oklch(62.3% 0.214 259.815)',
  blue600: 'oklch(54.6% 0.245 262.881)',
  blue700: 'oklch(48.8% 0.243 264.376)',

  red50: 'oklch(97.1% 0.013 17.38)',
  red100: 'oklch(93.6% 0.032 17.717)',
  red200: 'oklch(88.5% 0.062 18.334)',
  red300: 'oklch(80.8% 0.114 19.571)',
  red500: 'oklch(63.7% 0.237 25.331)',
  red600: 'oklch(57.7% 0.245 27.325)',
  red700: 'oklch(50.5% 0.213 27.518)',

  green50: 'oklch(98.2% 0.018 155.826)',
  green100: 'oklch(96.2% 0.044 156.743)',
  green200: 'oklch(92.5% 0.084 155.995)',
  green300: 'oklch(87.1% 0.15 154.449)',
  green600: 'oklch(62.7% 0.194 149.214)',
  green700: 'oklch(52.7% 0.154 150.069)',
  green800: 'oklch(44.8% 0.119 151.328)',

  amber50: 'oklch(98.7% 0.022 95.277)',
  amber200: 'oklch(92.4% 0.12 95.746)',
  amber300: 'oklch(87.9% 0.169 91.605)',
  amber500: 'oklch(76.9% 0.188 70.08)',
  amber600: 'oklch(66.6% 0.179 58.318)',
  amber700: 'oklch(55.5% 0.163 48.998)',
  amber800: 'oklch(47.3% 0.137 46.201)',

  yellow100: 'oklch(97.3% 0.071 103.193)',
  yellow700: 'oklch(55.4% 0.135 66.442)',

  orange100: 'oklch(95.4% 0.038 75.164)',
  orange700: 'oklch(55.3% 0.195 38.402)',
});

export const space = stylex.defineConsts({
  px2: '2px',
  px4: '4px',
  px6: '6px',
  px8: '8px',
  px10: '10px',
  px12: '12px',
  px14: '14px',
  px16: '16px',
  px20: '20px',
  px24: '24px',
  px28: '28px',
  px32: '32px',
  px40: '40px',
  px48: '48px',
  px56: '56px',
  px64: '64px',
  px80: '80px',
  px96: '96px',
  px128: '128px',
  px192: '192px',
  px224: '224px',
  px256: '256px',
  px320: '320px',
});

export const fontSize = stylex.defineConsts({
  px12: '12px',
  px14: '14px',
  px18: '18px',
  px20: '20px',
  px24: '24px',
});

export const lineHeight = stylex.defineConsts({
  px16: '16px',
  px20: '20px',
  px28: '28px',
  px32: '32px',
});

export const radius = stylex.defineConsts({
  px4: '4px',
  px8: '8px',
});

export const shadow = stylex.defineConsts({
  base: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
});

export const maxWidth = stylex.defineConsts({
  px192: '192px',
  px256: '256px',
  px384: '384px',
  px448: '448px',
  px512: '512px',
  px576: '576px',
  px672: '672px',
  px768: '768px',
  px896: '896px',
  px1024: '1024px',
});

export const breakpoint = stylex.defineConsts({
  sm: '@media (min-width: 640px)',
  lg: '@media (min-width: 1024px)',
});
