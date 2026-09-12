import { spawn, ChildProcess } from 'child_process';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import * as net from 'net';

// Root of the monorepo (frontend/ -> ../)
const ROOT = resolve(__dirname, '..', '..', '..');
const TMP_DIR = resolve(__dirname, '..', '..', '.e2e-tmp');
const URLS_FILE = resolve(TMP_DIR, 'urls.json');

let mockProc: ChildProcess | null = null;
let smtpProc: ChildProcess | null = null;
let gatewayProc: ChildProcess | null = null;
let gatewayTmpDir: string | null = null;

/**
 * Parent environment with every `GATEWAY_*` variable stripped.
 *
 * The gateway subprocess loads `GATEWAY_*` from the repository root `.env`
 * (pydantic-settings), so inheriting the developer's environment would leak
 * real credentials (e.g. SMTP) into the tests. Explicit `envExtra` wins.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GATEWAY_')),
  );
}

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

async function spawnProc(
  command: string,
  args: string[],
  envExtra: Record<string, string>,
  options: { cwd?: string } = {},
): Promise<ChildProcess> {
  const proc = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...cleanEnv(), ...envExtra },
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
  const smtpPort = await freePort();
  const smtpControlPort = await freePort();
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  const smtpCaptureUrl = `http://127.0.0.1:${smtpControlPort}`;

  mockProc = await spawnProc('uv', [
    'run', 'python',
    resolve(ROOT, 'tests', 'e2e', 'mock_server.py'),
    '--port', String(mockPort),
    '--host', '127.0.0.1',
  ], {});
  await waitReady(`${mockUrl}/health`);

  smtpProc = await spawnProc('uv', [
    'run', 'python',
    resolve(ROOT, 'tests', 'e2e', 'smtp_capture_server.py'),
    '--smtp-port', String(smtpPort),
    '--control-port', String(smtpControlPort),
    '--smtp-host', '127.0.0.1',
    '--control-host', '127.0.0.1',
  ], {});
  await waitReady(`${smtpCaptureUrl}/health`);

  // Private cwd so the gateway never picks up the repository root `.env`.
  gatewayTmpDir = mkdtempSync(join(tmpdir(), 'gateway-e2e-'));
  gatewayProc = await spawnProc('uv', [
    // --project keeps uv's environment resolution at the repo root while the
    // process itself runs in the private cwd below.
    'run', '--project', ROOT, 'uvicorn',
    'mineru_gateway.main:create_app',
    '--factory',
    '--host', '127.0.0.1',
    '--port', String(gatewayPort),
  ], {
    GATEWAY_UPSTREAM_URL: mockUrl,
    GATEWAY_ADMIN_TOKEN: 'e2e-admin-token',
    GATEWAY_USER_AUTH_ENABLED: 'true',
    GATEWAY_JWT_SECRET: 'e2e-jwt-secret-at-least-32-chars!!',
    GATEWAY_OPEN_REGISTRATION: 'true',
    GATEWAY_ALLOW_UNVERIFIED_ACCOUNTS: 'true',
    GATEWAY_SMTP_HOST: '127.0.0.1',
    GATEWAY_SMTP_PORT: String(smtpPort),
    GATEWAY_SMTP_FROM: 'e2e@example.com',
    GATEWAY_SMTP_USERNAME: '',
    GATEWAY_SMTP_PASSWORD: '',
    GATEWAY_SMTP_STARTTLS: 'false',
    GATEWAY_SMTP_SSL_TLS: 'false',
    GATEWAY_GATEWAY_URL: gatewayUrl,
    GATEWAY_OIDC_PROVIDERS: '[{"name":"keycloak","openid_configuration_endpoint":"https://e2e.example.com/.well-known/openid-configuration","client_id":"e2e-client","client_secret":"e2e-secret"}]',
    GATEWAY_CORS_ALLOW_ORIGINS: '["http://localhost:5173"]',
    GATEWAY_CORS_ALLOW_CREDENTIALS: 'true',
    GATEWAY_CREATE_TABLES: 'true',
    GATEWAY_ENABLE_BACKGROUND: 'false',
    GATEWAY_JSON_LOGS: 'false',
    GATEWAY_MAX_UPLOAD_SIZE: '1048576',
    GATEWAY_RATE_LIMIT_PER_KEY: '10',
    GATEWAY_MAX_CONCURRENT_TASKS: '0',
  }, { cwd: gatewayTmpDir });
  await waitReady(`${gatewayUrl}/health`);

  writeFileSync(URLS_FILE, JSON.stringify({
    mockUrl,
    gatewayUrl,
    smtpCaptureUrl,
    mockPort,
    gatewayPort,
    smtpPort,
    smtpControlPort,
  }));
}

export async function teardown(): Promise<void> {
  for (const proc of [mockProc, smtpProc, gatewayProc]) {
    if (proc && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        proc.on('close', () => resolve());
        setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3000);
      });
    }
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
  if (gatewayTmpDir) {
    rmSync(gatewayTmpDir, { recursive: true, force: true });
    gatewayTmpDir = null;
  }
}
