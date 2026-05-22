import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../internal-token.js', () => ({
  INTERNAL_TOKEN_HEADER: 'x-panopticon-internal-token',
  getInternalToken: vi.fn(() => 'test-token'),
}));

const originalFetch = globalThis.fetch;
const originalDashboardUrl = process.env.DASHBOARD_URL;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.resetModules();
  process.env.DASHBOARD_URL = 'http://dashboard.test';
  process.env.NODE_ENV = 'development';
  globalThis.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDashboardUrl === undefined) {
    delete process.env.DASHBOARD_URL;
  } else {
    process.env.DASHBOARD_URL = originalDashboardUrl;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe('notifyPipeline', () => {
  it('forwards lifecycle events across the process boundary', async () => {
    const { notifyPipeline } = await import('../pipeline-notifier.js');

    notifyPipeline({ type: 'review.approved', issueId: 'PAN-1381' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://dashboard.test/api/internal/pipeline/notify',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-panopticon-internal-token': 'test-token',
        }),
        body: JSON.stringify({ type: 'review.approved', issueId: 'PAN-1381' }),
      }),
    );
  });
});
