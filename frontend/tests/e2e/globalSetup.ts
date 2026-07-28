import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import * as net from 'net';

// Root of the monorepo (frontend/ -> ../)
const ROOT = resolve(__dirname, '..', '..', '..');
const TMP_DIR = resolve(__dirname, '..', '..', '.e2e-tmp');
const URLS_FILE = resolve(TMP_DIR, 'urls.json');

let mockProc: ChildProcess | null = null;
let gatewayProc: ChildProcess | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const info = s.address();
      const port = typeof info === 'string' ? 0 : info?.port ?? 0;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function waitReady(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    async function poll() {
      while (Date.now() < deadline) {
        try {
          const resp = await fetch(url, { method: 'GET' });
          if (resp.status < 500) {
            resolve();
            return;
          }
        } catch {
          // not ready yet
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      reject(new Error(`service at ${url} not ready in ${timeoutMs}ms`));
    }
    poll();
  });
}

async function spawnProc(command: string, args: string[], envExtra: Record<string, string>): Promise<ChildProcess> {
  const proc = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...envExtra },
    stdio: 'ignore',
  });
  proc.on('error', (_err) => {
    // best-effort — errors surface via waitReady timeout
  });
  return proc;
}

export async function setup(): Promise<void> {
  mkdirSync(TMP_DIR, { recursive: true });

  const mockPort = await freePort();
  const gatewayPort = await freePort();
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  mockProc = await spawnProc('uv', [
    'run', 'python',
    resolve(ROOT, 'tests', 'e2e', 'mock_server.py'),
    '--port', String(mockPort),
    '--host', '127.0.0.1',
  ], {});
  await waitReady(`${mockUrl}/health`);

  gatewayProc = await spawnProc('uv', [
    'run', 'uvicorn',
    'mineru_gateway.main:create_app',
    '--factory',
    '--host', '127.0.0.1',
    '--port', String(gatewayPort),
  ], {
    GATEWAY_UPSTREAM_URL: mockUrl,
    GATEWAY_ADMIN_TOKEN: 'e2e-admin-token',
    GATEWAY_CORS_ALLOW_ORIGINS: '["http://localhost:5173"]',
    GATEWAY_CORS_ALLOW_CREDENTIALS: 'true',
    GATEWAY_CREATE_TABLES: 'true',
    GATEWAY_ENABLE_BACKGROUND: 'false',
    GATEWAY_JSON_LOGS: 'false',
    GATEWAY_MAX_UPLOAD_SIZE: '1048576',
    GATEWAY_RATE_LIMIT_PER_KEY: '10',
    GATEWAY_MAX_CONCURRENT_TASKS: '0',
  });
  await waitReady(`${gatewayUrl}/health`);

  writeFileSync(URLS_FILE, JSON.stringify({ mockUrl, gatewayUrl, mockPort, gatewayPort }));
}

export async function teardown(): Promise<void> {
  for (const proc of [mockProc, gatewayProc]) {
    if (proc && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        proc.on('close', () => resolve());
        setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3000);
      });
    }
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
}
