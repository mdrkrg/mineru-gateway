/**
 * SmtpCapture talks to the smtp capture sidecar's control API to read the
 * inbox of messages the e2e gateway sent. Tests use it to extract the
 * verification link from a captured email and assert it is well-formed.
 */
export interface CapturedEmail {
  id: number;
  from: string;
  to: string[];
  subject: string;
  body_text: string;
  received_at: string;
}

export class SmtpCapture {
  constructor(private readonly baseUrl: string) { }

  async all(to?: string): Promise<CapturedEmail[]> {
    const url = to
      ? `${this.baseUrl}/emails?to=${encodeURIComponent(to)}`
      : `${this.baseUrl}/emails`;
    const resp = await fetch(url);
    return (await resp.json()) as CapturedEmail[];
  }

  async clear(): Promise<void> {
    await fetch(`${this.baseUrl}/emails`, { method: 'DELETE' });
  }
}
