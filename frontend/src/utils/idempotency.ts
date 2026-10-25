/**
 * Idempotency-key generation for task submissions.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS or
 * localhost). The SPA may be served over plain HTTP on a LAN, so fall back to
 * `crypto.getRandomValues()`, which is available in insecure contexts. The key
 * only needs to be unique per API key; it is not a secret.
 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
