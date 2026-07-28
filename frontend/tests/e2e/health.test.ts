/**
 * E2E tests for the health endpoint.
 *
 * Verifies that getHealth() correctly reports aggregated gateway and upstream
 * health status over a real HTTP connection to a running gateway + mock upstream.
 *
 * The mock upstream exposes health states via its /_mock/configure API:
 *   1. Default (healthy): upstream /health returns 200 with status="healthy"
 *   2. Degraded:           upstream /health returns 503 with status="degraded"
 *      Gateway wraps this as 503 with status="degraded" and full upstream
 *      payload (no error field).
 *   3. Upstream raises:    upstream /health raises RuntimeError, FastAPI
 *      returns 500, gateway defaults status to "unknown" and returns 503.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setApiBaseUrl } from '../../src/core';
import { isHttpError } from '../../src/core';
import { getHealth } from '../../src/api';
import { MockControl } from './mock-control';
import { loadE2EUrls } from './helpers';

let mock: MockControl;

beforeAll(async () => {
  const urls = loadE2EUrls();
  setApiBaseUrl(urls.gatewayUrl);
  mock = new MockControl(urls.mockUrl);
  await mock.reset();
});

afterAll(async () => {
  await mock.reset();
});

describe('GET /health', () => {
  it('returns healthy upstream info when upstream is healthy', async () => {
    const result = await getHealth();
    expect(result.isOk()).toBe(true);

    if (!result.isOk()) return;
    expect(result.value.gateway).toBe('healthy');
    expect(result.value.status).toBe('healthy');

    const up = result.value.upstream;
    expect(up.status).toBe('healthy');
    expect(up.version).toBeTruthy();
    expect(up.freeSlots).toBeGreaterThanOrEqual(0);
    expect(up.maxConcurrentRequests).toBeGreaterThan(0);
    expect(typeof up.queuedTasks).toBe('number');
    expect(typeof up.processingTasks).toBe('number');
  });

  it('returns degraded 503 when upstream is unhealthy but reachable', async () => {
    await mock.setUnhealthy();

    const result = await getHealth();
    expect(result.isErr()).toBe(true);

    if (!result.isErr()) return;
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;

    expect(result.error.status).toBe(503);
    const body = result.error.data;
    expect(body.gateway).toBe('healthy');
    expect(body.status).toBe('degraded');
    expect(body.upstream.status).toBe('degraded');
    expect(body.upstream.error).toBeUndefined();
  });

  it('returns 503 with degraded status when upstream raises', async () => {
    await mock.reset();
    await mock.setHealthRaises();

    const result = await getHealth();
    expect(result.isErr()).toBe(true);

    if (!result.isErr()) return;
    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;

    expect(result.error.status).toBe(503);
    const body = result.error.data;
    expect(body.gateway).toBe('healthy');
    expect(body.status).toBe('degraded');
    expect(body.upstream.status).toBe('unknown');
  });
});
