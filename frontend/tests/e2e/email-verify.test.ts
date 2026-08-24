/**
 * E2E tests for the email verification flow against a running gateway +
 * the smtp capture sidecar (see tests/e2e/smtp_capture_server.py).
 *
 * The capture sidecar receives real SMTP deliveries from the gateway,
 * so the test can extract the verification link from the email body
 * and exercise the full link round-trip.
 *
 * Each test creates its own user to avoid order-dependent state sharing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setApiBaseUrl } from '../../src/core';
import {
  register,
  login,
  getCurrentUser,
  requestVerifyToken,
} from '../../src/api';
import { MockControl } from './mock-control';
import { SmtpCapture } from './smtp-capture';
import { loadE2EUrls } from './helpers';

let mock: MockControl;
let smtp: SmtpCapture;
let gatewayUrl: string;

const FROM = 'e2e@example.com';

function freshEmail(label: string): string {
  return `verify-${label}-${Date.now()}@example.com`;
}

beforeAll(async () => {
  const urls = loadE2EUrls();
  setApiBaseUrl(urls.gatewayUrl);
  gatewayUrl = urls.gatewayUrl;
  mock = new MockControl(urls.mockUrl);
  smtp = new SmtpCapture(urls.smtpCaptureUrl);
  await mock.reset();
  await smtp.clear();
});

afterAll(async () => {
  await smtp.clear();
  await mock.reset();
});

function extractLink(body: string): string {
  const match = body.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no link found in email body: ${JSON.stringify(body)}`);
  return match[0].replace(/[)\].,]+$/, '');
}

async function registerUser(email: string) {
  return await register({
    email,
    password: 'secret123',
    isActive: null,
    isSuperuser: null,
    isVerified: null,
    displayName: null,
  });
}

async function loginUser(email: string) {
  const result = await login({ email, password: 'secret123' });
  if (!result.isOk()) throw new Error('login failed');
  return result.value.accessToken;
}

async function captureVerificationEmail(email: string): Promise<string> {
  await expect.poll(() => smtp.all(email), {
    timeout: 5000,
    interval: 100,
  }).not.toHaveLength(0);

  const [captured] = (await smtp.all(email)).slice(-1);
  expect(captured.from).toBe(FROM);
  expect(captured.to).toContain(email);
  expect(captured.subject.toLowerCase()).toContain('verify');
  expect(captured.body_text).toMatch(/verify your email/i);

  return extractLink(captured.body_text);
}

async function assertLinkWellFormed(link: string): Promise<URL> {
  const url = new URL(link);
  expect(url.host).toBe(new URL(gatewayUrl).host);
  expect(url.pathname).toBe('/auth/verify');
  expect(url.searchParams.get('token')).toBeTruthy();
  return url;
}

describe('email verification flow', () => {
  it('registers an unverified user', async () => {
    const email = freshEmail('reg');
    const result = await registerUser(email);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.email).toBe(email);
    expect(result.value.isVerified).toBe(false);
  });

  it('login returns an unverified profile', async () => {
    const email = freshEmail('login');
    await registerUser(email);

    const accessToken = await loginUser(email);
    const me = await getCurrentUser(accessToken);

    expect(me.isOk()).toBe(true);
    if (!me.isOk()) return;
    expect(me.value.email).toBe(email);
    expect(me.value.isVerified).toBe(false);
  });

  it('captures a real verification email with a well-formed link', async () => {
    const email = freshEmail('capture');
    await registerUser(email);

    const send = await requestVerifyToken({ email });
    expect(send.isOk()).toBe(true);
    if (!send.isOk()) return;
    expect(send.value.status).toBe(202);

    const link = await captureVerificationEmail(email);
    await assertLinkWellFormed(link);
  });

  it('GET the link verifies the user and the DB reflects it', async () => {
    const email = freshEmail('verify');
    await registerUser(email);

    const link = await captureVerificationEmail(email);
    await assertLinkWellFormed(link);

    const accessToken = await loginUser(email);
    const resp = await fetch(link, { redirect: 'manual' });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { is_verified: boolean };
    expect(body.is_verified).toBe(true);

    const me = await getCurrentUser(accessToken);
    expect(me.isOk()).toBe(true);
    if (!me.isOk()) return;
    expect(me.value.isVerified).toBe(true);
  });

  it('re-using the same link after verification is rejected with 400', async () => {
    const email = freshEmail('reuse');
    await registerUser(email);

    const link = await captureVerificationEmail(email);
    await assertLinkWellFormed(link);

    await fetch(link, { redirect: 'manual' });
    const resp = await fetch(link, { redirect: 'manual' });
    expect(resp.status).toBe(400);
  });
});
