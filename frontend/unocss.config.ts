import { defineConfig, presetWind4 } from 'unocss';

export default defineConfig({
  presets: [
    presetWind4({
      preflights: {
        reset: true,
      },
    }),
  ],
  preflights: [
    {
      // TODO: add a custom highlight
      getCSS: () => `
        *:focus-visible { }
      `,
    },
  ],
});
