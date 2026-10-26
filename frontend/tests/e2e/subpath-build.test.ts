import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FRONTEND_ROOT = resolve(__dirname, '..', '..');
const originalBasePath = process.env.VITE_APP_BASE_PATH;
const originalApiPrefix = process.env.VITE_API_PREFIX;

let outputDir = '';
let indexHtml = '';
let publicAssets: string[] = [];

describe('subpath production build', () => {
  beforeAll(async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'mineru-subpath-build-'));
    process.env.VITE_APP_BASE_PATH = '/mineru/';
    process.env.VITE_API_PREFIX = '/mineru/api';

    await build({
      root: FRONTEND_ROOT,
      configFile: resolve(FRONTEND_ROOT, 'vite.config.ts'),
      mode: 'production',
      build: {
        outDir: outputDir,
        emptyOutDir: true,
      },
    });

    indexHtml = readFileSync(join(outputDir, 'index.html'), 'utf8');
    publicAssets = [
      ...indexHtml.matchAll(/(?:src|href)="(\/mineru\/assets\/[^"]+)"/g),
    ].map((match) => match[1]);
  }, 30_000);

  afterAll(() => {
    if (originalBasePath === undefined) delete process.env.VITE_APP_BASE_PATH;
    else process.env.VITE_APP_BASE_PATH = originalBasePath;
    if (originalApiPrefix === undefined) delete process.env.VITE_API_PREFIX;
    else process.env.VITE_API_PREFIX = originalApiPrefix;
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  it('emits only base-prefixed asset URLs', () => {
    expect(indexHtml).toMatch(/(?:src|href)="\/mineru\/assets\//);
    expect(indexHtml).not.toMatch(/(?:src|href)="\/assets\//);
    expect(publicAssets.length).toBeGreaterThan(0);
    for (const asset of publicAssets) {
      expect(existsSync(join(outputDir, asset.replace('/mineru/', '')))).toBe(true);
    }
  });

  it('bakes the router base and API prefix into the application bundle', () => {
    const bundles = publicAssets.map((asset) =>
      readFileSync(join(outputDir, asset.replace('/mineru/', '')), 'utf8'),
    );
    const application = bundles.join('\n');
    expect(application).toContain('"/mineru/"');
    expect(application).toContain('"/mineru/api"');
  });
});
