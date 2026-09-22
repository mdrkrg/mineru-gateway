import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import UnocssPlugin from '@unocss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import stylex from '@stylexjs/unplugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      stylex.vite({
        sxPropName: false,
        aliases: {
          '@/*': [resolve(__dirname, 'src', '*')],
        },
        unstable_moduleResolution: { type: 'commonJS', rootDir: __dirname },
      }),
      devtools(),
      tanstackRouter({ target: 'solid' }),
      solidPlugin(),
      UnocssPlugin(),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '^/api': {
          target: env.VITE_API_BASE,
          changeOrigin: true,
          secure: false,
          ws: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      target: 'esnext',
    },
  }
});
