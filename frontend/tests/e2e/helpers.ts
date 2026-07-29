import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ParseRequestFields } from '../../src/api/schemas/mineru-options';

const URLS_FILE = resolve(__dirname, '..', '..', '.e2e-tmp', 'urls.json');

export function loadE2EUrls(): { mockUrl: string; gatewayUrl: string; mockPort: number; gatewayPort: number } {
  return JSON.parse(readFileSync(URLS_FILE, 'utf-8'));
}

export async function createApiKey(gatewayUrl: string): Promise<{ apiKey: string; keyId: string }> {
  const resp = await fetch(`${gatewayUrl}/auth/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': 'e2e-admin-token',
    },
    body: JSON.stringify({ label: 'e2e' }),
  });
  if (!resp.ok) {
    throw new Error(`failed to create API key: ${resp.status} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { apiKey: body.api_key, keyId: body.key_id };
}

/**
 * A minimal, structurally valid PDF that the mock upstream accepts (content
 * validation is on by default and rejects non-PDF files with 400).
 */
export const MINIMAL_PDF = (() => {
  const lines = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]',
    '/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    '4 0 obj<</Length 44>>stream',
    'BT /F1 12 Tf 100 700 Td (Hello) Tj ET',
    'endstream',
    'endobj',
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000266 00000 n ',
    '0000000360 00000 n ',
    'trailer<</Size 6/Root 1 0 R>>',
    'startxref',
    '418',
    '%%EOF',
  ];
  return new Blob([lines.join('\n') + '\n'], { type: 'application/pdf' });
})();

export function samplePdfFormData(): ParseRequestFields {
  return {
    files: [new File([MINIMAL_PDF], 'doc.pdf', { type: 'application/pdf' })],
    backend: 'hybrid-engine',
  };
}
