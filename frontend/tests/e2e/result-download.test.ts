/**
 * E2E tests for result download against a background-enabled gateway.
 *
 * The shared e2e gateway (globalSetup.ts) runs with
 * GATEWAY_ENABLE_BACKGROUND=false, so tasks stay pending and never grow a
 * downloadable result.  These tests start a second, purpose-built gateway
 * whose status-sync loop runs every 0.5s so that mock upstream transitions
 * ("failed") propagate into the task record.
 *
 * Covered:
 *   GET  /tasks/{id}/result  -> 200 for a failed task with a (partial) result
 *   POST /tasks/result-zip   -> 409 + non_downloadable reason "not_completed"
 *                               when a still-active task is mixed in
 *
 * The "missing_upstream_task_id" reason branch cannot be produced through the
 * public API, so it is covered by backend unit tests instead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { resolve, join } from 'path';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as net from 'net';
import { setApiBaseUrl, isHttpError } from '../../src/core';
import {
  createApiKey,
  submitTask,
  getTaskDetail,
  listTasks,
  getTaskResult,
  downloadResultZip,
} from '../../src/api';
import { MockControl } from './mock-control';
import { loadE2EUrls, samplePdfFormData } from './helpers';

const ROOT = resolve(__dirname, '..', '..', '..');

let apiKey: string;
let mock: MockControl;
let gatewayProc: ChildProcess | null = null;
let gatewayDir: string | null = null;
let gatewayUrl: string;

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

async function waitReady(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${url}/health`);
      if (resp.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`gateway at ${url} not ready in ${timeoutMs}ms`);
}

beforeAll(async () => {
  const urls = loadE2EUrls();
  mock = new MockControl(urls.mockUrl);

  // Private cwd + scrubbed GATEWAY_* so the repository root .env is ignored.
  gatewayDir = mkdtempSync(join(tmpdir(), 'gateway-e2e-bg-'));
  mkdirSync(join(gatewayDir, 'cache'), { recursive: true });
  const port = await freePort();
  gatewayUrl = `http://127.0.0.1:${port}`;

  const parentEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GATEWAY_')),
  );

  gatewayProc = spawn(
    'uv',
    [
      'run', '--project', ROOT, 'uvicorn',
      'mineru_gateway.main:create_app',
      '--factory',
      '--host', '127.0.0.1',
      '--port', String(port),
    ],
    {
      cwd: gatewayDir,
      env: {
        ...parentEnv,
        GATEWAY_UPSTREAM_URL: urls.mockUrl,
        GATEWAY_DATABASE_URL: `sqlite+aiosqlite:///${join(gatewayDir, 'gateway.db')}`,
        GATEWAY_FILE_CACHE_DIR: join(gatewayDir, 'cache'),
        GATEWAY_ADMIN_TOKEN: 'e2e-admin-token',
        GATEWAY_CREATE_TABLES: 'true',
        GATEWAY_ENABLE_BACKGROUND: 'true',
        GATEWAY_STATUS_SYNC_INTERVAL: '0.5',
        GATEWAY_RETRY_INTERVAL: '3600',
        GATEWAY_CLEANUP_INTERVAL: '3600',
        GATEWAY_JSON_LOGS: 'false',
        GATEWAY_MAX_UPLOAD_SIZE: '1048576',
        GATEWAY_RATE_LIMIT_PER_KEY: '100',
        GATEWAY_MAX_CONCURRENT_TASKS: '0',
      },
      stdio: 'ignore',
    },
  );
  gatewayProc.on('error', () => {
    // errors surface via waitReady timeout
  });
  await waitReady(gatewayUrl);

  setApiBaseUrl(gatewayUrl);
  const keyResult = await createApiKey(
    { label: 'e2e-result', expiresAt: null } as never,
    'e2e-admin-token',
  );
  if (!keyResult.isOk()) throw new Error('failed to create API key');
  apiKey = keyResult.value.apiKey;

  await mock.reset();
  await mock.setTaskStatus('processing');
});

afterAll(async () => {
  await mock.reset();
  if (gatewayProc && gatewayProc.exitCode === null) {
    gatewayProc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      gatewayProc!.on('close', () => resolve());
      setTimeout(() => {
        gatewayProc?.kill('SIGKILL');
        resolve();
      }, 3000);
    });
  }
  if (gatewayDir) {
    rmSync(gatewayDir, { recursive: true, force: true });
    gatewayDir = null;
  }
});

async function submit(): Promise<string> {
  const result = await submitTask({ apiKey, parseFields: samplePdfFormData() });
  if (!result.isOk()) throw new Error('submit failed');
  return result.value.taskId;
}

async function waitForResult(taskId: string): Promise<void> {
  await expect.poll(async () => {
    const detail = await getTaskDetail(taskId, apiKey);
    return detail.isOk() ? detail.value.hasResult : false;
  }, { timeout: 10_000, interval: 200 }).toBe(true);
}

describe('GET /tasks/{id}/result (background sync)', () => {
  it('serves a partial result once a failed task has synced', async () => {
    await mock.reset();
    await mock.setTaskStatus('processing');
    const taskId = await submit();

    await mock.setTaskStatus('failed');
    await waitForResult(taskId);

    const detail = await getTaskDetail(taskId, apiKey);
    expect(detail.isOk()).toBe(true);
    if (!detail.isOk()) return;
    expect(detail.value.status).toBe('failed');
    expect(detail.value.hasResult).toBe(true);

    const listed = await listTasks({ apiKey, hasResult: true });
    expect(listed.isOk()).toBe(true);
    if (!listed.isOk()) return;
    expect(listed.value.items.some((i) => i.taskId === taskId)).toBe(true);

    const result = await getTaskResult(taskId, apiKey);
    expect(result.isOk()).toBe(true);
  });
});

describe('POST /tasks/result-zip (partial results)', () => {
  it('rejects a batch containing a still-active task with not_completed', async () => {
    await mock.reset();
    await mock.setTaskStatus('processing');

    const failedId = await submit();
    await mock.setTaskStatus('failed');
    await waitForResult(failedId);

    // Keep the mock non-terminal so the second task never grows a result.
    await mock.setTaskStatus('processing');
    const activeId = await submit();

    const zip = await downloadResultZip([failedId, activeId], apiKey);
    expect(zip.isErr()).toBe(true);
    if (!zip.isErr()) return;
    expect(isHttpError(zip.error)).toBe(true);
    if (!isHttpError(zip.error)) return;
    expect(zip.error.status).toBe(409);

    const data = zip.error.data as {
      nonDownloadable: { taskId: string; status: string; reason: string }[];
    };
    const rejected = data.nonDownloadable.find((i) => i.taskId === activeId);
    expect(rejected).toBeTruthy();
    expect(rejected?.reason).toBe('not_completed');
    // The failed task itself is downloadable and must not be flagged.
    expect(data.nonDownloadable.some((i) => i.taskId === failedId)).toBe(false);
  });
});
