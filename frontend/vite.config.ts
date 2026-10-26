import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import stylex from '@stylexjs/unplugin';
import {
  escapeRegExp,
  normalizeApiPrefix,
  normalizeAppBasePath,
  stripPathPrefix,
} from './config/base-path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appBasePath = normalizeAppBasePath(env.VITE_APP_BASE_PATH);
  const apiPrefix = normalizeApiPrefix(env.VITE_API_PREFIX);
  const proxy = apiPrefix
    ? {
        [`^${escapeRegExp(apiPrefix)}(?:/|$)`]: {
          target: env.VITE_API_BASE,
          changeOrigin: true,
          secure: false,
          ws: true,
          rewrite: (path: string) => stripPathPrefix(path, apiPrefix),
        },
      }
    : {};

  return {
    base: appBasePath,
    define: {
      'import.meta.env.VITE_API_PREFIX': JSON.stringify(apiPrefix),
    },
    plugins: [
      stylex.vite({
        sxPropName: false,
        useCSSLayers: {
          before: ['reset'],
          prefix: 'stylex',
        },
        lightningcssOptions: {
          minify: true,
        },
        aliases: {
          '@/*': [resolve(__dirname, 'src', '*')],
        },
        unstable_moduleResolution: { type: 'commonJS', rootDir: __dirname },
      }),
      devtools(),
      tanstackRouter({ target: 'solid' }),
      solidPlugin(),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      proxy,
    },
    build: {
      target: 'esnext',
    },
  };
});
