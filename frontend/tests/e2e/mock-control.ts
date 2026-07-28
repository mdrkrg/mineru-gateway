/**
 * MockControl talks to the mock upstream's `/_mock/*` control API to
 * simulate upstream states during e2e tests.
 *
 * Every test's `beforeAll` should call `reset()` to start from a clean slate.
 */
export class MockControl {
  constructor(private readonly baseUrl: string) { }

  async reset(): Promise<void> {
    await fetch(`${this.baseUrl}/_mock/reset`, { method: 'POST' });
  }

  async configure(kv: Record<string, unknown>): Promise<void> {
    await fetch(`${this.baseUrl}/_mock/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kv),
    });
  }

  async setHealthRaises(): Promise<void> {
    await this.configure({ health_raises: true });
  }

  async setUnhealthy(): Promise<void> {
    await this.configure({ health_status: 'degraded' });
  }

  async setSubmitRaises(): Promise<void> {
    await this.configure({ submit_raises: true });
  }

  async setSubmitStatus(code: number): Promise<void> {
    await this.configure({ submit_status: code });
  }

  async setTaskStatus(status: string): Promise<void> {
    await this.configure({ task_status: status });
  }

  async setCancelRaises(): Promise<void> {
    await this.configure({ cancel_raises: true });
  }
}
